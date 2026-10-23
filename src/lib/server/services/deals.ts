// Sales Pipeline: deals and their moves on the board. Relative imports only: shared with Trigger.dev.
// Rules: docs/02-DATA-MODEL.md "Business rules" 1, 2, 3, 4b and "Ordering inside kanban columns".
import { and, asc, desc, eq, gte, ilike, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { DEAL_STAGE_META, type DealStage, type ServiceType } from '../../constants';
import { wibLocalToDate } from '../../format';
import type { DealInput, MoveInput, WonProjectInput } from '../../schemas/deal';
import type { DbOrTx, Tx } from '../db/client';
import { action, activity, client, deal, project, strategyPlan, user } from '../db/schema/index';
import { getNextActions, listCardSteps } from './actions';
import { logActivity } from './activity';
import { positionBetween, topOf } from './board-position';
import { ServiceError } from './errors';

/** Won / lost cards stay on the board this long (collapsed columns) */
export const RECENT_CLOSED_DAYS = 30;

export type BoardFilters = { q?: string; ownerId?: string; serviceType?: ServiceType };

export async function listBoardDeals(db: DbOrTx, filters: BoardFilters = {}) {
	const since = new Date(Date.now() - RECENT_CLOSED_DAYS * 24 * 60 * 60 * 1000);
	const where: SQL[] = [
		isNull(client.archivedAt),
		or(notInArray(deal.stage, ['won', 'lost']), gte(deal.stageChangedAt, since))!
	];
	const q = filters.q?.trim();
	if (q) {
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(or(ilike(deal.title, like), ilike(client.name, like))!);
	}
	if (filters.ownerId) where.push(eq(deal.ownerId, filters.ownerId));
	if (filters.serviceType) where.push(eq(deal.serviceType, filters.serviceType));

	const rows = await db
		.select({
			id: deal.id,
			title: deal.title,
			stage: deal.stage,
			position: deal.position,
			serviceType: deal.serviceType,
			valueEstimate: deal.valueEstimate,
			stageChangedAt: deal.stageChangedAt,
			clientId: deal.clientId,
			clientName: client.name,
			ownerId: deal.ownerId,
			ownerName: user.name,
			hasProject: sql<boolean>`exists (select 1 from ${project} where ${project}.deal_id = ${deal}.id)`
		})
		.from(deal)
		.innerJoin(client, eq(client.id, deal.clientId))
		.leftJoin(user, eq(user.id, deal.ownerId))
		.where(and(...where))
		.orderBy(asc(deal.stage), asc(deal.position), asc(deal.id));

	const next = await getNextActions(db, { dealIds: rows.map((r) => r.id) });
	return rows.map((r) => ({ ...r, next: next.get(r.id) ?? null }));
}

export type BoardDeal = Awaited<ReturnType<typeof listBoardDeals>>[number];

/** One deal with what the drawer shows */
export async function getDealDetail(db: DbOrTx, id: string) {
	const [row] = await db
		.select({
			id: deal.id,
			title: deal.title,
			stage: deal.stage,
			serviceType: deal.serviceType,
			valueEstimate: deal.valueEstimate,
			probability: deal.probability,
			expectedClose: deal.expectedClose,
			lostReason: deal.lostReason,
			stageChangedAt: deal.stageChangedAt,
			wonAt: deal.wonAt,
			createdAt: deal.createdAt,
			clientId: deal.clientId,
			clientName: client.name,
			ownerId: deal.ownerId,
			ownerName: user.name
		})
		.from(deal)
		.innerJoin(client, eq(client.id, deal.clientId))
		.leftJoin(user, eq(user.id, deal.ownerId))
		.where(eq(deal.id, id));
	if (!row) return null;

	const [linked, next, timeline, steps] = await Promise.all([
		db
			.select({ id: project.id, name: project.name, stage: project.stage })
			.from(project)
			.where(eq(project.dealId, id)),
		getNextActions(db, { dealIds: [id] }),
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
			.where(eq(activity.dealId, id))
			.orderBy(desc(activity.occurredAt), desc(activity.createdAt))
			.limit(30),
		listCardSteps(db, { dealId: id })
	]);
	return { ...row, project: linked[0] ?? null, next: next.get(id) ?? null, timeline, steps };
}

export type DealDetail = NonNullable<Awaited<ReturnType<typeof getDealDetail>>>;

// ---------- create / edit ----------

export async function assertOwner(tx: Tx, ownerId: string) {
	if (!ownerId) return;
	const [o] = await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId));
	if (!o) throw new ServiceError('Pemilik tidak ditemukan.', 'ownerId');
}

export async function createDeal(db: DbOrTx, input: DealInput, userId: string) {
	return db.transaction(async (tx) => {
		const [c] = await tx
			.select({ id: client.id, archivedAt: client.archivedAt })
			.from(client)
			.where(eq(client.id, input.clientId));
		if (!c) throw new ServiceError('Klien tidak ditemukan.', 'clientId');
		if (c.archivedAt) throw new ServiceError('Klien sudah diarsipkan.', 'clientId');
		await assertOwner(tx, input.ownerId);

		const stage = input.stage as DealStage;
		const ownerId = input.ownerId || userId;
		const [row] = await tx
			.insert(deal)
			.values({
				clientId: input.clientId,
				title: input.title,
				serviceType: (input.serviceType || null) as ServiceType | null,
				stage,
				position: await topOf(tx, deal, stage),
				valueEstimate: input.valueEstimate,
				probability: DEAL_STAGE_META[stage].probability,
				expectedClose: input.expectedClose || null,
				ownerId
			})
			.returning();

		await tx.insert(action).values({
			dealId: row.id,
			title: input.firstStepTitle,
			dueAt: wibLocalToDate(input.firstStepDue)!,
			assigneeId: ownerId
		});
		await logActivity(tx, {
			clientId: row.clientId,
			dealId: row.id,
			type: 'system',
			body: `Deal "${row.title}" dibuat di tahap ${DEAL_STAGE_META[stage].label}`,
			userId
		});
		return row;
	});
}

/** Edits the deal's details; the stage only changes through moveDeal (the board) */
export async function updateDeal(db: DbOrTx, id: string, input: DealInput, userId: string) {
	return db.transaction(async (tx) => {
		await assertOwner(tx, input.ownerId);
		const [row] = await tx
			.update(deal)
			.set({
				title: input.title,
				serviceType: (input.serviceType || null) as ServiceType | null,
				valueEstimate: input.valueEstimate,
				expectedClose: input.expectedClose || null,
				ownerId: input.ownerId || null
			})
			.where(eq(deal.id, id))
			.returning();
		if (!row) throw new ServiceError('Deal tidak ditemukan.');
		await logActivity(tx, {
			clientId: row.clientId,
			dealId: id,
			type: 'system',
			body: `Data deal "${row.title}" diperbarui`,
			userId
		});
		return row;
	});
}

// ---------- moves ----------

/**
 * Move a deal on the board (drag or "Pindah ke…"). Rules 1 (stage change + activity), 2 (won),
 * 3 (lost: reason, close open steps, drop the active plan) and 4b (plan follows the project).
 */
export async function moveDeal(
	db: DbOrTx,
	input: MoveInput,
	wonProject: WonProjectInput | null,
	userId: string
) {
	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(deal).where(eq(deal.id, input.id)).for('update');
		if (!current) throw new ServiceError('Deal tidak ditemukan.');
		const from = current.stage;
		const to = input.to;

		if (from === 'won' && to !== 'won') {
			const [linked] = await tx
				.select({ id: project.id })
				.from(project)
				.where(eq(project.dealId, current.id));
			if (linked) throw new ServiceError('Deal ini sudah punya proyek, jadi tetap di Deal ✓.');
		}

		const position = await positionBetween(
			tx,
			deal,
			to,
			input.beforeId || null,
			input.afterId || null,
			current.id
		);
		if (from === to) {
			await tx.update(deal).set({ position }).where(eq(deal.id, current.id));
			return { projectId: null };
		}

		const now = new Date();
		const keepsCustomProbability =
			current.probability !== null && current.probability !== DEAL_STAGE_META[from].probability;
		const [moved] = await tx
			.update(deal)
			.set({
				stage: to,
				position,
				stageChangedAt: now,
				probability: keepsCustomProbability ? current.probability : DEAL_STAGE_META[to].probability,
				wonAt: to === 'won' ? now : null,
				lostAt: to === 'lost' ? now : null,
				lostReason: to === 'lost' ? input.lostReason : null
			})
			.where(eq(deal.id, current.id))
			.returning();

		if (to === 'lost') {
			await tx
				.update(action)
				.set({ doneAt: now, doneBy: userId })
				.where(and(eq(action.dealId, current.id), isNull(action.doneAt)));
			await tx
				.update(strategyPlan)
				.set({ status: 'dropped' })
				.where(
					and(
						eq(strategyPlan.dealId, current.id),
						eq(strategyPlan.status, 'active'),
						isNull(strategyPlan.projectId)
					)
				);
		}

		await logActivity(tx, {
			clientId: current.clientId,
			dealId: current.id,
			type: 'stage_change',
			body:
				`Deal "${current.title}" pindah dari ${DEAL_STAGE_META[from].label} ke ${DEAL_STAGE_META[to].label}` +
				(to === 'lost' ? `. Alasan: ${input.lostReason}` : ''),
			meta: { from, to },
			userId
		});

		const projectId =
			to === 'won' && wonProject
				? await createProjectFromDeal(tx, moved, wonProject, userId)
				: null;
		return { projectId };
	});
}

/**
 * Hand-off (rule 2 + 4b): a project in Onboarding with the deal's client and service, its first
 * step, the client marked active, and the deal's active plan moved to the project.
 */
export async function createProjectFromDeal(
	db: DbOrTx,
	source: typeof deal.$inferSelect,
	input: WonProjectInput,
	userId: string
) {
	return db.transaction(async (tx) => {
		if (source.stage !== 'won')
			throw new ServiceError('Proyek hanya dibuat dari deal yang menang.');
		const [existing] = await tx
			.select({ id: project.id })
			.from(project)
			.where(eq(project.dealId, source.id));
		if (existing) throw new ServiceError('Deal ini sudah punya proyek.');

		const ownerId = source.ownerId ?? userId;
		const [created] = await tx
			.insert(project)
			.values({
				clientId: source.clientId,
				dealId: source.id,
				name: input.projectName,
				serviceType: source.serviceType,
				stage: 'onboarding',
				position: await topOf(tx, project, 'onboarding'),
				contractValue: input.contractValue,
				startDate: input.startDate,
				ownerId
			})
			.returning({ id: project.id, name: project.name });

		await tx.insert(action).values({
			projectId: created.id,
			title: input.firstStepTitle,
			dueAt: wibLocalToDate(input.firstStepDue)!,
			assigneeId: ownerId
		});
		await tx
			.update(client)
			.set({ status: 'active' })
			.where(and(eq(client.id, source.clientId), isNull(client.archivedAt)));
		await tx
			.update(strategyPlan)
			.set({ projectId: created.id })
			.where(and(eq(strategyPlan.dealId, source.id), eq(strategyPlan.status, 'active')));
		await logActivity(tx, {
			clientId: source.clientId,
			dealId: source.id,
			projectId: created.id,
			type: 'system',
			body: `Proyek "${created.name}" dibuat dari deal "${source.title}"`,
			userId
		});
		return created.id;
	});
}

/** "Buat proyek" later, from the drawer of a won deal without a project */
export async function createProjectForWonDeal(
	db: DbOrTx,
	dealId: string,
	input: WonProjectInput,
	userId: string
) {
	return db.transaction(async (tx) => {
		const [source] = await tx.select().from(deal).where(eq(deal.id, dealId)).for('update');
		if (!source) throw new ServiceError('Deal tidak ditemukan.');
		return createProjectFromDeal(tx, source, input, userId);
	});
}

/** Clients that can get a new deal (for the create form) */
export function listDealClients(db: DbOrTx) {
	return db
		.select({ id: client.id, name: client.name })
		.from(client)
		.where(isNull(client.archivedAt))
		.orderBy(asc(client.name));
}
