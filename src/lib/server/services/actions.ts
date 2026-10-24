// Steps (`action` rows) of deals and projects. Relative imports only: shared with Trigger.dev tasks.
// Rule (docs/02-DATA-MODEL.md, rule 4): every active card keeps at least one open step. Completing
// the last open step of a deal / project that is not won, lost or done needs the next step in the
// same call, so the card can never be left without one.
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm';
import {
	DEAL_STAGE_META,
	NEXT_DEAL_STAGE,
	NEXT_PROJECT_STAGE,
	PROJECT_STAGE_META,
	TERMINAL_STAGES,
	type DealStage,
	type ProjectStage
} from '../../constants';
import { stepDueAt, type StepInput } from '../../schemas/step';
import type { DbOrTx, Tx } from '../db/client';
import { action, deal, project, user } from '../db/schema/index';
import { logActivity } from './activity';
import { moveDeal } from './deals';
import { ServiceError } from './errors';
import { moveProject } from './projects';

export type NextAction = { id: string; title: string; dueAt: Date; allDay: boolean };

/** A step belongs to exactly one deal or one project */
export type CardRef =
	{ dealId: string; projectId?: undefined } | { projectId: string; dealId?: undefined };

/** A card's next action = its earliest open step (docs/02-DATA-MODEL.md). Keyed by deal / project id. */
export async function getNextActions(
	db: DbOrTx,
	{ dealIds = [], projectIds = [] }: { dealIds?: string[]; projectIds?: string[] }
) {
	const byCard = new Map<string, NextAction>();
	const pick = { id: action.id, title: action.title, dueAt: action.dueAt, allDay: action.allDay };

	if (dealIds.length) {
		const rows = await db
			.selectDistinctOn([action.dealId], { ...pick, cardId: action.dealId })
			.from(action)
			.where(and(inArray(action.dealId, dealIds), isNull(action.doneAt)))
			.orderBy(asc(action.dealId), asc(action.dueAt));
		for (const { cardId, ...next } of rows) if (cardId) byCard.set(cardId, next);
	}
	if (projectIds.length) {
		const rows = await db
			.selectDistinctOn([action.projectId], { ...pick, cardId: action.projectId })
			.from(action)
			.where(and(inArray(action.projectId, projectIds), isNull(action.doneAt)))
			.orderBy(asc(action.projectId), asc(action.dueAt));
		for (const { cardId, ...next } of rows) if (cardId) byCard.set(cardId, next);
	}
	return byCard;
}

const cardWhere = (ref: CardRef) =>
	ref.dealId ? eq(action.dealId, ref.dealId) : eq(action.projectId, ref.projectId!);

/** Open steps (earliest first) and the latest completed ones, for the drawer */
export async function listCardSteps(db: DbOrTx, ref: CardRef, doneLimit = 5) {
	const fields = {
		id: action.id,
		title: action.title,
		dueAt: action.dueAt,
		allDay: action.allDay,
		assigneeId: action.assigneeId,
		assigneeName: user.name,
		doneAt: action.doneAt,
		planId: action.planId
	};
	const [open, done] = await Promise.all([
		db
			.select(fields)
			.from(action)
			.leftJoin(user, eq(user.id, action.assigneeId))
			.where(and(cardWhere(ref), isNull(action.doneAt)))
			.orderBy(asc(action.dueAt), asc(action.sort)),
		db
			.select(fields)
			.from(action)
			.leftJoin(user, eq(user.id, action.assigneeId))
			.where(and(cardWhere(ref), isNotNull(action.doneAt)))
			.orderBy(desc(action.doneAt))
			.limit(doneLimit)
	]);
	return { open, done };
}

export type CardSteps = Awaited<ReturnType<typeof listCardSteps>>;

/** Client, stage and name of the card a step belongs to */
async function cardContext(tx: Tx, ref: CardRef) {
	if (ref.dealId) {
		const [d] = await tx
			.select({
				clientId: deal.clientId,
				stage: deal.stage,
				title: deal.title,
				ownerId: deal.ownerId
			})
			.from(deal)
			.where(eq(deal.id, ref.dealId));
		if (!d) throw new ServiceError('Deal tidak ditemukan.');
		return { ...d, kind: 'deal' as const, terminal: TERMINAL_STAGES.includes(d.stage) };
	}
	const [p] = await tx
		.select({
			clientId: project.clientId,
			stage: project.stage,
			title: project.name,
			ownerId: project.ownerId
		})
		.from(project)
		.where(eq(project.id, ref.projectId!));
	if (!p) throw new ServiceError('Proyek tidak ditemukan.');
	return { ...p, kind: 'project' as const, terminal: TERMINAL_STAGES.includes(p.stage) };
}

async function assertAssignee(tx: Tx, assigneeId: string) {
	if (!assigneeId) return;
	const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
	if (!u) throw new ServiceError('Penanggung jawab tidak ditemukan.', 'assigneeId');
}

/** Add a step to a deal or project (assignee defaults to the card owner, then the user) */
export async function addAction(
	db: DbOrTx,
	ref: CardRef,
	input: StepInput,
	userId: string,
	extra: { planId?: string | null; sort?: number } = {}
) {
	return db.transaction(async (tx) => {
		const ctx = await cardContext(tx, ref);
		await assertAssignee(tx, input.assigneeId);
		// A plan step without an explicit position goes to the end of its plan
		let sort = extra.sort ?? 0;
		if (extra.planId && extra.sort === undefined) {
			const [{ last }] = await tx
				.select({ last: max(action.sort) })
				.from(action)
				.where(eq(action.planId, extra.planId));
			sort = last === null ? 0 : last + 1;
		}
		const [row] = await tx
			.insert(action)
			.values({
				dealId: ref.dealId ?? null,
				projectId: ref.projectId ?? null,
				planId: extra.planId ?? null,
				sort,
				title: input.title,
				dueAt: stepDueAt(input),
				allDay: input.allDay,
				assigneeId: input.assigneeId || ctx.ownerId || userId
			})
			.returning();
		await logActivity(tx, {
			clientId: ctx.clientId,
			dealId: ref.dealId ?? null,
			projectId: ref.projectId ?? null,
			type: 'system',
			body: `Langkah ditambahkan: ${row.title}`,
			userId
		});
		return row;
	});
}

/** Edit / reschedule an open step */
export async function updateAction(db: DbOrTx, id: string, input: StepInput, userId: string) {
	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(action).where(eq(action.id, id)).for('update');
		if (!current) throw new ServiceError('Langkah tidak ditemukan.');
		if (current.doneAt) throw new ServiceError('Langkah ini sudah selesai.');
		await assertAssignee(tx, input.assigneeId);
		const ref = refOf(current);
		const ctx = await cardContext(tx, ref);
		const [row] = await tx
			.update(action)
			.set({
				title: input.title,
				dueAt: stepDueAt(input),
				allDay: input.allDay,
				assigneeId: input.assigneeId || current.assigneeId
			})
			.where(eq(action.id, id))
			.returning();
		await logActivity(tx, {
			clientId: ctx.clientId,
			dealId: ref.dealId ?? null,
			projectId: ref.projectId ?? null,
			type: 'system',
			body: `Langkah diubah: ${row.title}`,
			userId
		});
		return row;
	});
}

function refOf(row: { dealId: string | null; projectId: string | null }): CardRef {
	if (row.dealId) return { dealId: row.dealId };
	return { projectId: row.projectId! };
}

export type CompleteOptions = {
	/** The next step; required when this was the card's last open step and the card is active */
	next?: StepInput | null;
	/** "Pindahkan ke [next stage]" (NEXT_DEAL_STAGE / NEXT_PROJECT_STAGE) */
	moveToNextStage?: boolean;
};

/**
 * Tick a step off (rule 4). Logs `action_done`; adds the next step and moves the card in the same
 * transaction when asked. Returns how many open steps the card has afterwards.
 */
export async function completeAction(
	db: DbOrTx,
	id: string,
	opts: CompleteOptions,
	userId: string
) {
	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(action).where(eq(action.id, id)).for('update');
		if (!current) throw new ServiceError('Langkah tidak ditemukan.');
		if (current.doneAt) throw new ServiceError('Langkah ini sudah selesai.');
		const ref = refOf(current);
		const ctx = await cardContext(tx, ref);

		const [{ openNow }] = await tx
			.select({ openNow: count() })
			.from(action)
			.where(and(cardWhere(ref), isNull(action.doneAt)));
		// openNow includes this step
		const isLast = openNow <= 1;
		if (isLast && !ctx.terminal && !opts.next) {
			throw new ServiceError('Ini langkah terakhir. Tambahkan langkah berikutnya.', 'next');
		}

		await tx.update(action).set({ doneAt: new Date(), doneBy: userId }).where(eq(action.id, id));
		await logActivity(tx, {
			clientId: ctx.clientId,
			dealId: ref.dealId ?? null,
			projectId: ref.projectId ?? null,
			type: 'action_done',
			body: current.title,
			userId
		});

		if (opts.next) await addAction(tx, ref, opts.next, userId, { planId: current.planId });

		if (opts.moveToNextStage) {
			if (ctx.kind === 'deal') {
				const to = NEXT_DEAL_STAGE[ctx.stage as DealStage];
				if (!to)
					throw new ServiceError(
						`Deal di tahap ${DEAL_STAGE_META[ctx.stage as DealStage].label} tidak punya tahap berikutnya di sini.`
					);
				await moveDeal(
					tx,
					{
						id: ref.dealId!,
						to,
						beforeId: '',
						afterId: '',
						lostReason: '',
						createProject: '',
						dropProject: ''
					},
					null,
					userId
				);
			} else {
				const to = NEXT_PROJECT_STAGE[ctx.stage as ProjectStage];
				if (!to)
					throw new ServiceError(
						`Proyek di tahap ${PROJECT_STAGE_META[ctx.stage as ProjectStage].label} tidak punya tahap berikutnya di sini.`
					);
				await moveProject(tx, { id: ref.projectId!, to, beforeId: '', afterId: '' }, userId);
			}
		}

		const [{ open }] = await tx
			.select({ open: count() })
			.from(action)
			.where(and(cardWhere(ref), isNull(action.doneAt)));
		return { open };
	});
}
