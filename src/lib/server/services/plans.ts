// Strategi: strategy plans, their steps, "Perlu perhatian", the schedule and the sidebar badge.
// Relative imports only: shared with Trigger.dev tasks (the daily digest reuses attentionSteps).
// A plan follows one deal or one project; its steps are that card's `action` rows with plan_id set.
import {
	and,
	asc,
	eq,
	exists,
	gte,
	ilike,
	inArray,
	isNull,
	lt,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { dayKeyWib, wibLocalToDate } from '../../format';
import { addDays } from '../../period';
import type { PlanInput } from '../../schemas/plan';
import { parseCard } from '../../schemas/plan';
import type { StepInput } from '../../schemas/step';
import type { DbOrTx } from '../db/client';
import { action, client, deal, project, strategyPlan, user } from '../db/schema/index';
import { addAction } from './actions';
import { logActivity } from './activity';
import { ServiceError } from './errors';

export const PLANS_PER_PAGE = 3;
export const STEPS_PER_PAGE = 4;

export type StrategyFilters = {
	q?: string;
	/** "Saya": steps assigned to / plans owned by this user */
	mineOf?: string;
};

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Open steps of the same card as the current `action` row. Written with explicit table names:
// inside a correlated subquery an unqualified column would resolve to the inner table.
const cardOpenSteps = sql<number>`(select count(*)::int from "action" as "other" where "other"."done_at" is null and ("other"."deal_id" = "action"."deal_id" or "other"."project_id" = "action"."project_id"))`;

/** One step with everything the Strategi rows need (client, card, plan, open steps on its card) */
function stepSelect() {
	return {
		id: action.id,
		title: action.title,
		dueAt: action.dueAt,
		allDay: action.allDay,
		doneAt: action.doneAt,
		sort: action.sort,
		planId: action.planId,
		planGoal: strategyPlan.goal,
		assigneeId: action.assigneeId,
		assigneeName: user.name,
		clientId: client.id,
		clientName: client.name,
		dealId: action.dealId,
		projectId: action.projectId,
		cardTitle: sql<string>`coalesce(${project.name}, ${deal.title})`,
		dealStage: deal.stage,
		projectStage: project.stage,
		cardOpenSteps
	};
}

function stepsFrom(db: DbOrTx) {
	return db
		.select(stepSelect())
		.from(action)
		.leftJoin(deal, eq(deal.id, action.dealId))
		.leftJoin(project, eq(project.id, action.projectId))
		.innerJoin(client, eq(client.id, sql`coalesce(${deal.clientId}, ${project.clientId})`))
		.leftJoin(user, eq(user.id, action.assigneeId))
		.leftJoin(strategyPlan, eq(strategyPlan.id, action.planId));
}

export type StrategyStep = Awaited<ReturnType<ReturnType<typeof stepsFrom>['where']>>[number];

function stepFilters(f: StrategyFilters): SQL[] {
	const where: SQL[] = [isNull(client.archivedAt)];
	if (f.mineOf) where.push(eq(action.assigneeId, f.mineOf));
	const q = f.q?.trim();
	if (q) {
		const like = likeOf(q);
		where.push(
			or(ilike(action.title, like), ilike(client.name, like), ilike(strategyPlan.goal, like))!
		);
	}
	return where;
}

/** Start of tomorrow in WIB: steps due before it are late or due today */
function endOfTodayWib(now = new Date()) {
	return wibLocalToDate(`${addDays(dayKeyWib(now), 1)}T00:00`)!;
}

/** "Perlu perhatian": open steps that are late or due today (ignores the period filter) */
export function attentionSteps(db: DbOrTx, f: StrategyFilters = {}, now = new Date()) {
	return stepsFrom(db)
		.where(and(isNull(action.doneAt), lt(action.dueAt, endOfTodayWib(now)), ...stepFilters(f)))
		.orderBy(asc(action.dueAt));
}

/** "Jadwal": steps (open and done) due inside the period [from, to) */
export function scheduleSteps(db: DbOrTx, from: Date, to: Date, f: StrategyFilters = {}) {
	return stepsFrom(db)
		.where(and(gte(action.dueAt, from), lt(action.dueAt, to), ...stepFilters(f)))
		.orderBy(asc(action.dueAt), asc(action.sort));
}

/** Sidebar badge on "Strategi": late + due-today steps assigned to the user */
export async function attentionCount(db: DbOrTx, userId: string, now = new Date()) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(action)
		.leftJoin(deal, eq(deal.id, action.dealId))
		.leftJoin(project, eq(project.id, action.projectId))
		.innerJoin(client, eq(client.id, sql`coalesce(${deal.clientId}, ${project.clientId})`))
		.where(
			and(
				isNull(action.doneAt),
				eq(action.assigneeId, userId),
				lt(action.dueAt, endOfTodayWib(now)),
				isNull(client.archivedAt)
			)
		);
	return n;
}

// ---------- plans ----------

const planOrder = [
	sql`${strategyPlan.targetDate} asc nulls last`,
	asc(strategyPlan.createdAt),
	asc(strategyPlan.id)
];

function planFilters(f: StrategyFilters): SQL[] {
	const where: SQL[] = [eq(strategyPlan.status, 'active'), isNull(client.archivedAt)];
	if (f.mineOf) where.push(eq(strategyPlan.ownerId, f.mineOf));
	const q = f.q?.trim();
	if (q) {
		const like = likeOf(q);
		where.push(
			or(
				ilike(client.name, like),
				ilike(strategyPlan.goal, like),
				exists(
					sql`(select 1 from "action" as "s" where "s"."plan_id" = "strategy_plan"."id" and "s"."title" ilike ${like})`
				)
			)!
		);
	}
	return where;
}

/** Order of steps inside a plan */
const stepOrder = [asc(action.sort), asc(action.dueAt), asc(action.id)];

/** Page (1-based) holding the first unfinished step; page 1 when everything is done */
export function firstOpenPage(steps: { doneAt: Date | null }[], perPage = STEPS_PER_PAGE) {
	const i = steps.findIndex((s) => !s.doneAt);
	return i < 0 ? 1 : Math.floor(i / perPage) + 1;
}

/**
 * Active plans, 3 per page, nearest target first. Each plan carries its card, progress and the
 * page of steps that holds its first unfinished step (other pages load on demand).
 */
export async function listPlans(db: DbOrTx, f: StrategyFilters & { page?: number } = {}) {
	const page = Math.max(1, f.page ?? 1);
	const where = and(...planFilters(f));
	const base = db
		.select({
			id: strategyPlan.id,
			goal: strategyPlan.goal,
			targetDate: strategyPlan.targetDate,
			notes: strategyPlan.notes,
			fromSuggestionId: strategyPlan.fromSuggestionId,
			ownerId: strategyPlan.ownerId,
			clientId: client.id,
			clientName: client.name,
			dealId: strategyPlan.dealId,
			projectId: strategyPlan.projectId,
			dealTitle: deal.title,
			dealStage: deal.stage,
			dealValue: deal.valueEstimate,
			projectName: project.name,
			projectStage: project.stage,
			projectValue: project.contractValue
		})
		.from(strategyPlan)
		.innerJoin(client, eq(client.id, strategyPlan.clientId))
		.leftJoin(deal, eq(deal.id, strategyPlan.dealId))
		.leftJoin(project, eq(project.id, strategyPlan.projectId));

	const [rows, [{ total }]] = await Promise.all([
		base
			.where(where)
			.orderBy(...planOrder)
			.limit(PLANS_PER_PAGE)
			.offset((page - 1) * PLANS_PER_PAGE),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(strategyPlan)
			.innerJoin(client, eq(client.id, strategyPlan.clientId))
			.where(where)
	]);

	const ids = rows.map((r) => r.id);
	const steps = ids.length
		? await stepsFrom(db)
				.where(inArray(action.planId, ids))
				.orderBy(...stepOrder)
		: [];

	const plans = rows.map((r) => {
		const all = steps.filter((s) => s.planId === r.id);
		const stepPage = firstOpenPage(all);
		return {
			...r,
			totalSteps: all.length,
			doneSteps: all.filter((s) => s.doneAt).length,
			stepPage,
			steps: all.slice((stepPage - 1) * STEPS_PER_PAGE, stepPage * STEPS_PER_PAGE)
		};
	});
	return { plans, total, page, perPage: PLANS_PER_PAGE };
}

export type PlanCardData = Awaited<ReturnType<typeof listPlans>>['plans'][number];

/** One page of a plan's steps (the card's small pager) */
export async function planStepsPage(db: DbOrTx, planId: string, page: number) {
	const all = await stepsFrom(db)
		.where(eq(action.planId, planId))
		.orderBy(...stepOrder);
	const pages = Math.max(1, Math.ceil(all.length / STEPS_PER_PAGE));
	const p = Math.min(Math.max(1, page), pages);
	return {
		steps: all.slice((p - 1) * STEPS_PER_PAGE, p * STEPS_PER_PAGE),
		page: p,
		total: all.length
	};
}

/** Open deals and active projects a new plan can follow, for the plan form */
export async function listPlanCards(db: DbOrTx) {
	const [deals, projects] = await Promise.all([
		db
			.select({ id: deal.id, title: deal.title, stage: deal.stage, clientName: client.name })
			.from(deal)
			.innerJoin(client, eq(client.id, deal.clientId))
			.where(and(isNull(client.archivedAt), sql`${deal.stage} not in ('won', 'lost')`))
			.orderBy(asc(client.name), asc(deal.title)),
		db
			.select({
				id: project.id,
				title: project.name,
				stage: project.stage,
				clientName: client.name
			})
			.from(project)
			.innerJoin(client, eq(client.id, project.clientId))
			.where(and(isNull(client.archivedAt), sql`${project.stage} <> 'done'`))
			.orderBy(asc(client.name), asc(project.name))
	]);
	return { deals, projects };
}

export async function createPlan(db: DbOrTx, input: PlanInput, userId: string) {
	return db.transaction(async (tx) => {
		const card = parseCard(input.card);
		if (!card) throw new ServiceError('Pilih deal atau proyek.', 'card');
		const [target] =
			'dealId' in card
				? await tx
						.select({
							clientId: deal.clientId,
							closed: sql<boolean>`${deal.stage} in ('won', 'lost')`
						})
						.from(deal)
						.where(eq(deal.id, card.dealId))
				: await tx
						.select({ clientId: project.clientId, closed: sql<boolean>`${project.stage} = 'done'` })
						.from(project)
						.where(eq(project.id, card.projectId));
		if (!target) throw new ServiceError('Deal atau proyek tidak ditemukan.', 'card');
		if (target.closed) throw new ServiceError('Deal atau proyek ini sudah ditutup.', 'card');

		const [row] = await tx
			.insert(strategyPlan)
			.values({
				clientId: target.clientId,
				dealId: 'dealId' in card ? card.dealId : null,
				projectId: 'projectId' in card ? card.projectId : null,
				goal: input.goal,
				targetDate: input.targetDate || null,
				notes: input.notes || null,
				ownerId: userId
			})
			.returning();
		await logActivity(tx, {
			clientId: row.clientId,
			dealId: row.dealId,
			projectId: row.projectId,
			type: 'system',
			body: `Rencana dibuat: ${row.goal}`,
			userId
		});
		return row;
	});
}

export async function updatePlan(db: DbOrTx, id: string, input: PlanInput, userId: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.update(strategyPlan)
			.set({ goal: input.goal, targetDate: input.targetDate || null, notes: input.notes || null })
			.where(eq(strategyPlan.id, id))
			.returning();
		if (!row) throw new ServiceError('Rencana tidak ditemukan.');
		await logActivity(tx, {
			clientId: row.clientId,
			dealId: row.dealId,
			projectId: row.projectId,
			type: 'system',
			body: `Rencana diperbarui: ${row.goal}`,
			userId
		});
		return row;
	});
}

const STATUS_TEXT = {
	achieved: 'tercapai',
	dropped: 'dibatalkan',
	active: 'diaktifkan lagi'
} as const;

/** Mark achieved / dropped (or reactivate). Steps stay on their card either way. */
export async function setPlanStatus(
	db: DbOrTx,
	id: string,
	status: 'achieved' | 'dropped' | 'active',
	userId: string
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.update(strategyPlan)
			.set({ status })
			.where(eq(strategyPlan.id, id))
			.returning();
		if (!row) throw new ServiceError('Rencana tidak ditemukan.');
		await logActivity(tx, {
			clientId: row.clientId,
			dealId: row.dealId,
			projectId: row.projectId,
			type: 'system',
			body: `Rencana ${STATUS_TEXT[status]}: ${row.goal}`,
			userId
		});
		return row;
	});
}

/** Add a step at the end of a plan; it lands on the plan's card (the project once the deal is won) */
export async function addPlanStep(db: DbOrTx, planId: string, input: StepInput, userId: string) {
	return db.transaction(async (tx) => {
		const [plan] = await tx.select().from(strategyPlan).where(eq(strategyPlan.id, planId));
		if (!plan) throw new ServiceError('Rencana tidak ditemukan.');
		if (plan.status !== 'active') throw new ServiceError('Rencana ini tidak aktif lagi.');
		const ref = plan.projectId ? { projectId: plan.projectId } : { dealId: plan.dealId! };
		return addAction(tx, ref, input, userId, { planId });
	});
}

/** Move a step one place up or down inside its plan (rewrites the plan's sort to 0..n) */
export async function moveStep(db: DbOrTx, stepId: string, direction: 'up' | 'down') {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({ planId: action.planId })
			.from(action)
			.where(eq(action.id, stepId));
		if (!current?.planId) throw new ServiceError('Langkah ini tidak ada di rencana.');
		const ordered = await tx
			.select({ id: action.id })
			.from(action)
			.where(eq(action.planId, current.planId))
			.orderBy(...stepOrder);
		const i = ordered.findIndex((s) => s.id === stepId);
		const j = direction === 'up' ? i - 1 : i + 1;
		if (j < 0 || j >= ordered.length) return;
		[ordered[i], ordered[j]] = [ordered[j], ordered[i]];
		for (const [sort, s] of ordered.entries()) {
			await tx.update(action).set({ sort }).where(eq(action.id, s.id));
		}
	});
}
