// Project Delivery: projects and their moves on the board. Relative imports only: shared with Trigger.dev.
// Rules: docs/02-DATA-MODEL.md "Business rules" 1 and "Ordering inside kanban columns". Projects are
// created from won deals (deals.ts createProjectFromDeal).
import { and, asc, desc, eq, gte, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { PROJECT_STAGE_META, type ServiceType } from '../../constants';
import type { ProjectInput, ProjectMoveInput } from '../../schemas/project';
import type { DbOrTx } from '../db/client';
import { activity, client, deal, project, transaction, user } from '../db/schema/index';
import { getNextActions, listCardSteps } from './actions';
import { logActivity } from './activity';
import { positionBetween } from './board-position';
import { assertOwner, RECENT_CLOSED_DAYS, type BoardFilters } from './deals';
import { ServiceError } from './errors';

/** Paid income of the project (payment progress = paid ÷ contract value). Totals are never stored. */
export const paidIncome = sql<number>`coalesce((
	select sum("transaction"."amount") from ${transaction}
	where "transaction"."project_id" = "project"."id"
		and "transaction"."type" = 'income' and "transaction"."status" = 'paid'
), 0)::bigint`.mapWith(Number);

export async function listBoardProjects(db: DbOrTx, filters: BoardFilters = {}) {
	const since = new Date(Date.now() - RECENT_CLOSED_DAYS * 24 * 60 * 60 * 1000);
	// Selesai keeps the last 30 days on the board; older ones stay on the client page
	const where: SQL[] = [
		isNull(client.archivedAt),
		or(ne(project.stage, 'done'), gte(project.stageChangedAt, since))!
	];
	const q = filters.q?.trim();
	if (q) {
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(or(ilike(project.name, like), ilike(client.name, like))!);
	}
	if (filters.ownerId) where.push(eq(project.ownerId, filters.ownerId));
	if (filters.serviceType) where.push(eq(project.serviceType, filters.serviceType));

	const rows = await db
		.select({
			id: project.id,
			name: project.name,
			stage: project.stage,
			position: project.position,
			serviceType: project.serviceType,
			contractValue: project.contractValue,
			paid: paidIncome,
			targetEndDate: project.targetEndDate,
			stageChangedAt: project.stageChangedAt,
			clientId: project.clientId,
			clientName: client.name,
			ownerId: project.ownerId,
			ownerName: user.name
		})
		.from(project)
		.innerJoin(client, eq(client.id, project.clientId))
		.leftJoin(user, eq(user.id, project.ownerId))
		.where(and(...where))
		.orderBy(asc(project.stage), asc(project.position), asc(project.id));

	const next = await getNextActions(db, { projectIds: rows.map((r) => r.id) });
	return rows.map((r) => ({ ...r, next: next.get(r.id) ?? null }));
}

export type BoardProject = Awaited<ReturnType<typeof listBoardProjects>>[number];

/** One project with what the drawer shows */
export async function getProjectDetail(db: DbOrTx, id: string) {
	const [row] = await db
		.select({
			id: project.id,
			name: project.name,
			stage: project.stage,
			serviceType: project.serviceType,
			contractValue: project.contractValue,
			paid: paidIncome,
			startDate: project.startDate,
			targetEndDate: project.targetEndDate,
			finishedAt: project.finishedAt,
			stageChangedAt: project.stageChangedAt,
			clientId: project.clientId,
			clientName: client.name,
			dealId: project.dealId,
			dealTitle: deal.title,
			ownerId: project.ownerId,
			ownerName: user.name
		})
		.from(project)
		.innerJoin(client, eq(client.id, project.clientId))
		.leftJoin(deal, eq(deal.id, project.dealId))
		.leftJoin(user, eq(user.id, project.ownerId))
		.where(eq(project.id, id));
	if (!row) return null;

	const [next, timeline, steps] = await Promise.all([
		getNextActions(db, { projectIds: [id] }),
		db
			.select({
				id: activity.id,
				type: activity.type,
				body: activity.body,
				occurredAt: activity.occurredAt,
				userName: user.name
			})
			.from(activity)
			.leftJoin(user, eq(user.id, activity.userId))
			.where(eq(activity.projectId, id))
			.orderBy(desc(activity.occurredAt), desc(activity.createdAt))
			.limit(30),
		listCardSteps(db, { projectId: id })
	]);
	return { ...row, next: next.get(id) ?? null, timeline, steps };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

/** Edits the project's details; the stage only changes through moveProject (the board) */
export async function updateProject(db: DbOrTx, input: ProjectInput, userId: string) {
	return db.transaction(async (tx) => {
		await assertOwner(tx, input.ownerId);
		const [row] = await tx
			.update(project)
			.set({
				name: input.name,
				serviceType: (input.serviceType || null) as ServiceType | null,
				contractValue: input.contractValue,
				startDate: input.startDate || null,
				targetEndDate: input.targetEndDate || null,
				ownerId: input.ownerId || null
			})
			.where(eq(project.id, input.id))
			.returning();
		if (!row) throw new ServiceError('Proyek tidak ditemukan.');
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.id,
			type: 'system',
			body: `Data proyek "${row.name}" diperbarui`,
			userId
		});
		return row;
	});
}

/**
 * Move a project on the board (drag or "Pindah ke…"): stage, position and an activity (rule 1).
 * Selesai stamps `finished_at`; Maintenance keeps it; an earlier stage clears it (reopened).
 */
export async function moveProject(db: DbOrTx, input: ProjectMoveInput, userId: string) {
	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(project).where(eq(project.id, input.id)).for('update');
		if (!current) throw new ServiceError('Proyek tidak ditemukan.');
		const from = current.stage;
		const to = input.to;

		const position = await positionBetween(
			tx,
			project,
			to,
			input.beforeId || null,
			input.afterId || null,
			current.id
		);
		if (from === to) {
			await tx.update(project).set({ position }).where(eq(project.id, current.id));
			return;
		}

		const now = new Date();
		await tx
			.update(project)
			.set({
				stage: to,
				position,
				stageChangedAt: now,
				finishedAt:
					to === 'done'
						? (current.finishedAt ?? now)
						: to === 'maintenance'
							? current.finishedAt
							: null
			})
			.where(eq(project.id, current.id));

		await logActivity(tx, {
			clientId: current.clientId,
			projectId: current.id,
			type: 'stage_change',
			body: `Proyek "${current.name}" pindah dari ${PROJECT_STAGE_META[from].label} ke ${PROJECT_STAGE_META[to].label}`,
			meta: { from, to },
			userId
		});
	});
}
