// Strategy chat on Telegram (client request after P2-10): "strategi untuk IMR?" shows the client's
// active plans and open Saran AI (Terima / Abaikan), and the AI answers, discusses and may propose
// a plan that the sender saves with Simpan. Follow-up messages within 30 minutes continue the same
// conversation. Relative imports only: the Trigger.dev task runs this, the webhook handles buttons.
import { and, asc, desc, eq, gt, inArray, ne, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { AI_KIND_LABELS } from '../../constants';
import { dateID, dateToWibLocal } from '../../format';
import { parseDue } from '../../import/client-csv';
import { planSchema } from '../../schemas/plan';
import { stepSchema, type StepInput } from '../../schemas/step';
import type { AiComplete } from '../ai/client';
import {
	STRATEGY_PROPOSALS,
	STRATEGY_SCHEMA,
	STRATEGY_SYSTEM,
	strategyUserMessage
} from '../ai/prompts/strategy-chat';
import type { DbOrTx, Tx } from '../db/client';
import {
	action,
	aiSuggestion,
	deal,
	project,
	strategyPlan,
	telegramDraft
} from '../db/schema/index';
import { escapeHtml, type TelegramButton } from '../notify/telegram';
import {
	acceptSuggestion,
	buildClientContext,
	dismissSuggestion,
	listOpenSuggestions
} from './ai-suggestions';
import { updateAction, type CardRef } from './actions';
import { ServiceError } from './errors';
import { addPlanStep, createPlan } from './plans';

/** `telegram_draft.kind` of a strategy conversation */
export const STRATEGY = 'strategy';
/** A conversation stays open this long after the last message */
export const CHAT_MINUTES = 30;
/** Turns kept for the AI (each side's message is one turn) */
const HISTORY_TURNS = 12;

type Turn = { from: 'user' | 'bot'; text: string };
type Card = { kind: 'deal' | 'project'; id: string; title: string };
type StepDraft = { title: string; due: string };
/** A step of an existing plan to move or rename (`id`), or a new one (`id` null) */
type PlanStepChange = StepDraft & { id: string | null; before: StepDraft | null };

export type Proposal =
	| { action: 'new_plan'; card: Card; goal: string; targetDate: string; steps: StepDraft[] }
	| {
			action: 'update_plan';
			planId: string;
			goal: string;
			card: Card | null;
			steps: PlanStepChange[];
	  };

/** `telegram_draft.payload` of a strategy conversation */
export type StrategyChat = {
	clientId: string;
	clientName: string;
	history: Turn[];
	proposal: Proposal | null;
};

const esc = escapeHtml;

// ---------- data ----------

/** The open conversation of this chat (newest, not expired), if any */
export async function openStrategyChat(db: DbOrTx, chatId: string, now: Date) {
	const [row] = await db
		.select()
		.from(telegramDraft)
		.where(
			and(
				eq(telegramDraft.chatId, chatId),
				eq(telegramDraft.kind, STRATEGY),
				eq(telegramDraft.status, 'pending'),
				gt(telegramDraft.expiresAt, now)
			)
		)
		.orderBy(desc(telegramDraft.createdAt))
		.limit(1);
	return row ?? null;
}

/** Everything the bot shows and the AI reads about one client */
async function loadStrategyData(db: DbOrTx, clientId: string) {
	const ctx = await buildClientContext(db, clientId);
	if (ctx.client.archivedAt) throw new ServiceError('Klien ini sudah diarsipkan.');
	const [plans, suggestions] = await Promise.all([
		db
			.select({
				id: strategyPlan.id,
				goal: strategyPlan.goal,
				targetDate: strategyPlan.targetDate,
				dealId: strategyPlan.dealId,
				projectId: strategyPlan.projectId,
				dealTitle: deal.title,
				projectName: project.name
			})
			.from(strategyPlan)
			.leftJoin(deal, eq(deal.id, strategyPlan.dealId))
			.leftJoin(project, eq(project.id, strategyPlan.projectId))
			.where(and(eq(strategyPlan.clientId, clientId), eq(strategyPlan.status, 'active')))
			.orderBy(asc(strategyPlan.createdAt)),
		listOpenSuggestions(db, { clientId })
	]);
	const steps = plans.length
		? await db
				.select({
					id: action.id,
					planId: action.planId,
					title: action.title,
					dueAt: action.dueAt,
					doneAt: action.doneAt
				})
				.from(action)
				.where(
					inArray(
						action.planId,
						plans.map((p) => p.id)
					)
				)
				.orderBy(asc(action.dueAt))
		: [];
	const cards: Card[] = [
		...ctx.facts.deal_terbuka.map((d) => ({ kind: 'deal' as const, id: d.id, title: d.judul })),
		...ctx.facts.proyek_berjalan.map((p) => ({ kind: 'project' as const, id: p.id, title: p.nama }))
	];
	// Short refs for the AI: L1, L2, … across all open plan steps
	let ref = 0;
	return {
		ctx,
		cards,
		plans: plans.map((p) => {
			const mine = steps.filter((s) => s.planId === p.id);
			return {
				...p,
				// a plan that moved to the project (rule 4b) belongs to the project
				card: (p.projectId
					? { kind: 'project', id: p.projectId, title: p.projectName ?? '' }
					: p.dealId
						? { kind: 'deal', id: p.dealId, title: p.dealTitle ?? '' }
						: null) as Card | null,
				done: mine.filter((s) => s.doneAt).length,
				open: mine.filter((s) => !s.doneAt).map((s) => ({ ...s, ref: `L${++ref}` }))
			};
		}),
		suggestions
	};
}

type StrategyData = Awaited<ReturnType<typeof loadStrategyData>>;

// ---------- messages ----------

const wib = (d: Date) => `${dateID(d, 'long')} ${dateID(d, 'time')} WIB`;
/** "Kamis, 30 Okt 2026 10:00 WIB" from a WIB wall time */
const whenText = (due: string) => `${dateID(due.slice(0, 10), 'long')} ${due.slice(11, 16)} WIB`;

/** The first message: what is planned and what is open */
export function overviewHtml(clientName: string, data: StrategyData) {
	const lines = [`<b>Strategi · ${esc(clientName)}</b>`];
	if (!data.plans.length) lines.push('Belum ada rencana aktif.');
	for (const p of data.plans) {
		const total = p.done + p.open.length;
		lines.push(
			'',
			`<b>${esc(p.goal)}</b>${p.card ? ` · ${esc(p.card.title)}` : ''}`,
			`${p.done}/${total} langkah selesai${p.targetDate ? ` · target ${esc(dateID(p.targetDate))}` : ''}`
		);
		const next = p.open[0];
		if (next) lines.push(`Berikutnya: ${esc(next.title)} (${esc(wib(next.dueAt))})`);
	}
	if (data.suggestions.length)
		lines.push('', `<i>${data.suggestions.length} saran AI terbuka di bawah.</i>`);
	return lines.join('\n');
}

type SuggestionRow = StrategyData['suggestions'][number];

export function suggestionHtml(
	s: Pick<SuggestionRow, 'kind' | 'insight' | 'proposedAction' | 'proposedDueAt' | 'cardTitle'>
) {
	return [
		`<b>Saran AI · ${esc(AI_KIND_LABELS[s.kind])}</b>${s.cardTitle ? ` · ${esc(s.cardTitle)}` : ''}`,
		esc(s.insight),
		`→ ${esc(s.proposedAction)}${s.proposedDueAt ? ` (${esc(wib(s.proposedDueAt))})` : ''}`
	].join('\n');
}

export function proposalHtml(p: Proposal) {
	const lines =
		p.action === 'new_plan'
			? [
					'<b>Usulan rencana baru</b>',
					`${p.card.kind === 'deal' ? 'Deal' : 'Proyek'}: <b>${esc(p.card.title)}</b>`,
					`Tujuan: ${esc(p.goal)}`,
					...(p.targetDate ? [`Target: ${esc(dateID(p.targetDate))}`] : [])
				]
			: ['<b>Usulan perubahan rencana</b>', `Rencana: <b>${esc(p.goal)}</b>`];
	p.steps.forEach((s, i) => {
		let note = '';
		if (p.action === 'update_plan') {
			const before = (s as PlanStepChange).before;
			note = !before
				? ' <i>(baru)</i>'
				: ` <i>(sebelumnya ${esc(whenText(before.due))}${before.title !== s.title ? ` · ${esc(before.title)}` : ''})</i>`;
		}
		lines.push(`${i + 1}. ${esc(whenText(s.due))} · ${esc(s.title)}${note}`);
	});
	return lines.join('\n');
}

/** What the conversation message shows: the AI's answer, then the proposal */
export function turnHtml(chat: StrategyChat, reply: string) {
	return [
		`<b>Strategi · ${esc(chat.clientName)}</b>`,
		'',
		esc(reply),
		...(chat.proposal ? ['', proposalHtml(chat.proposal)] : [])
	].join('\n');
}

// ---------- the AI turn ----------

const text = z.string().catch('');
const answerSchema = z.object({
	leave: z.boolean().catch(false),
	reply: text,
	proposal_action: z.enum(STRATEGY_PROPOSALS).catch('keep'),
	target_id: text,
	plan_id: text,
	goal: text,
	target_date: text,
	steps: z.array(z.string()).catch([])
});

const LINE_DATE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}[:.]\d{2})?/;

/** "2026-10-26T10:00 | Kirim build UAT" → step, or the problem with it */
function stepOf(line: string, now: Date): StepDraft | string {
	const [left, ...rest] = line.split('|');
	const date = LINE_DATE.exec(rest.length ? left : line);
	const title = (rest.length ? rest.join('|') : date ? line.replace(date[0], '') : line)
		.replace(/\s+/g, ' ')
		.trim();
	if (title.length < 3) return 'Ada langkah tanpa judul.';
	if (!date) return `Langkah "${title}" belum punya tanggal.`;
	const due = parseDue(date[0].replace(' ', 'T').replace('.', ':'));
	if ('error' in due) return `Tanggal langkah "${title}" tidak bisa dibaca.`;
	if (due.due < dateToWibLocal(now)) return `Waktu langkah "${title}" sudah lewat.`;
	return { title: title.slice(0, 200), due: due.due };
}

/** Check the AI's proposal against the client's cards and plans */
function proposalOf(
	a: z.infer<typeof answerSchema>,
	previous: Proposal | null,
	data: StrategyData,
	now: Date
): { proposal: Proposal | null; problems: string[] } {
	if (a.proposal_action === 'keep') return { proposal: previous, problems: [] };
	if (a.proposal_action === 'none') return { proposal: null, problems: [] };
	const problems: string[] = [];
	const parse = (line: string) => {
		const s = stepOf(line, now);
		if (typeof s === 'string') {
			problems.push(s);
			return null;
		}
		return s;
	};
	if (a.proposal_action === 'new_plan') {
		const steps = a.steps
			.map((l) => parse(l.replace(/^\s*baru\s*\|/i, '')))
			.filter((s): s is StepDraft => !!s);
		if (!steps.length) problems.push('Usulan belum punya langkah.');
		const card = data.cards.find((c) => c.id === a.target_id);
		if (!card) problems.push('Usulan belum menyebut deal atau proyeknya.');
		const goal = a.goal.trim();
		if (goal.length < 5) problems.push('Usulan belum punya tujuan.');
		if (problems.length || !card) return { proposal: null, problems };
		const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(a.target_date.trim().slice(0, 10))
			? a.target_date.trim().slice(0, 10)
			: '';
		return {
			proposal: { action: 'new_plan', card, goal: goal.slice(0, 200), targetDate, steps },
			problems
		};
	}
	const plan = data.plans.find((p) => p.id === a.plan_id);
	if (!plan) return { proposal: null, problems: ['Usulan belum menyebut rencana yang diubah.'] };
	const changes: PlanStepChange[] = [];
	for (const line of a.steps) {
		const [head, ...rest] = line.split('|');
		const ref = head.trim().toUpperCase();
		if (/^L\d+$/.test(ref)) {
			const old = plan.open.find((s) => s.ref === ref);
			if (!old) {
				problems.push(`Langkah ${ref} tidak ada di rencana ini (yang selesai tidak bisa diubah).`);
				continue;
			}
			const s = parse(rest.join('|'));
			if (!s) continue;
			const before = { title: old.title, due: dateToWibLocal(old.dueAt) };
			// unchanged lines are not a change
			if (s.title !== before.title || s.due !== before.due)
				changes.push({ ...s, id: old.id, before });
			continue;
		}
		const s = parse(/^\s*baru\s*$/i.test(head) ? rest.join('|') : line);
		if (s) changes.push({ ...s, id: null, before: null });
	}
	if (!changes.length && !problems.length) problems.push('Usulan tidak mengubah apa pun.');
	if (!changes.length) return { proposal: null, problems };
	return {
		proposal: {
			action: 'update_plan',
			planId: plan.id,
			goal: plan.goal,
			card: plan.card,
			steps: changes
		},
		problems
	};
}

export type StrategyDeps = {
	complete: AiComplete;
	/** Send to the chat; returns the message id */
	send: (html: string, buttons?: TelegramButton[]) => Promise<number>;
	clearButtons: (messageId: number) => Promise<void>;
	/** "typing…" in the chat (lasts about 5 seconds; repeated while the AI works) */
	typing?: () => Promise<unknown>;
};

export type StrategyTurnResult = { status: 'answered'; proposal: boolean } | { status: 'left' };

const nowLine = (now: Date) =>
	`${dateID(now, 'long')} ${dateID(now, 'time')} WIB (${dateToWibLocal(now)})`;

/**
 * One message in a strategy conversation. A new conversation first gets the overview and the open
 * suggestions (with Terima / Abaikan). In an open one, a message that is clearly about something
 * else comes back as 'left' and nothing changes, so the normal Telegram input can take it.
 */
export async function runStrategyTurn(
	db: DbOrTx,
	input: {
		userId: string;
		chatId: string;
		clientId: string;
		text: string;
		source: 'text' | 'voice';
		/** The open conversation; null starts one */
		row: typeof telegramDraft.$inferSelect | null;
	},
	deps: StrategyDeps,
	now = new Date()
): Promise<StrategyTurnResult> {
	const data = await loadStrategyData(db, input.clientId);
	const chat: StrategyChat = input.row
		? (input.row.payload as unknown as StrategyChat)
		: { clientId: input.clientId, clientName: data.ctx.client.name, history: [], proposal: null };

	// Keep "typing…" visible while the AI thinks (often 20 to 60 seconds)
	void deps.typing?.().catch(() => {});
	const typing = deps.typing
		? setInterval(() => void deps.typing!().catch(() => {}), 4500)
		: undefined;
	const res = await deps
		.complete({
			system: STRATEGY_SYSTEM,
			user: strategyUserMessage({
				now: nowLine(now),
				client: data.ctx.facts,
				plans: data.plans.map((p) => ({
					id: p.id,
					tujuan: p.goal,
					target: p.targetDate,
					untuk: p.card ? `${p.card.kind === 'deal' ? 'Deal' : 'Proyek'} ${p.card.title}` : null,
					langkah_selesai: p.done,
					langkah_terbuka: p.open.map((s) => ({
						ref: s.ref,
						judul: s.title,
						jatuh_tempo: dateToWibLocal(s.dueAt)
					}))
				})),
				suggestions: data.suggestions.map((s) => ({
					jenis: s.kind,
					insight: s.insight,
					tindakan: s.proposedAction
				})),
				previous: chat.proposal,
				history: chat.history,
				message: input.text
			}),
			schema: STRATEGY_SCHEMA,
			schemaName: 'strategi_telegram',
			// Reasoning models think before the JSON, and this prompt carries the whole client
			maxTokens: 16000,
			allowText: true
		})
		.finally(() => clearInterval(typing));
	// A model that answers in prose still answers: the text is the reply, the proposal stays
	const a = answerSchema.parse(
		typeof res.json === 'string' ? { reply: res.json, proposal_action: 'keep' } : (res.json ?? {})
	);
	if (a.leave && input.row) return { status: 'left' };

	const { proposal, problems } = proposalOf(a, chat.proposal, data, now);
	chat.proposal = proposal;
	const reply =
		[a.reply.trim(), ...(problems.length ? [`(Usulan belum lengkap: ${problems.join(' ')})`] : [])]
			.filter(Boolean)
			.join('\n\n') || 'Baik.';
	chat.history = [
		...chat.history,
		{ from: 'user' as const, text: input.text.slice(0, 800) },
		{ from: 'bot' as const, text: reply.slice(0, 800) }
	].slice(-HISTORY_TURNS);

	if (!input.row) {
		await deps.send(overviewHtml(chat.clientName, data));
		for (const s of data.suggestions)
			await deps.send(suggestionHtml(s), [
				{ text: 'Terima', data: `a:${s.id}` },
				{ text: 'Abaikan', data: `d:${s.id}` }
			]);
	}

	const expiresAt = new Date(now.getTime() + CHAT_MINUTES * 60_000);
	let rowId = input.row?.id;
	if (input.row) {
		if (input.row.messageId)
			await deps.clearButtons(input.row.messageId).catch(() => {
				// the old buttons stay; tapping them saves the current proposal anyway
			});
	} else {
		const [row] = await db
			.insert(telegramDraft)
			.values({
				userId: input.userId,
				chatId: input.chatId,
				kind: STRATEGY,
				payload: chat as unknown as Record<string, unknown>,
				answer: {},
				source: input.source,
				input: input.text,
				expiresAt,
				// App clock: now() is frozen inside a transaction, and "the open chat" is the newest one
				createdAt: new Date()
			})
			.returning({ id: telegramDraft.id });
		rowId = row.id;
	}

	const footer = chat.proposal
		? `<i>Tekan Simpan untuk menyimpan usulan ini, atau balas untuk bertanya / mengubahnya (percakapan terbuka ${CHAT_MINUTES} menit).</i>`
		: `<i>Balas untuk bertanya lagi atau minta usulan rencana (percakapan terbuka ${CHAT_MINUTES} menit).</i>`;
	const messageId = await deps.send(
		`${turnHtml(chat, reply)}\n\n${footer}`,
		chat.proposal
			? [
					{ text: 'Simpan', data: `s:${rowId}` },
					{ text: 'Batal', data: `c:${rowId}` }
				]
			: undefined
	);
	await db
		.update(telegramDraft)
		.set({
			payload: chat as unknown as Record<string, unknown>,
			input: input.text,
			messageId,
			expiresAt
		})
		.where(eq(telegramDraft.id, rowId!));
	return { status: 'answered', proposal: !!chat.proposal };
}

/** Another client's conversation, or a finished one: closed without saving */
export async function closeStrategyChat(
	db: DbOrTx,
	row: typeof telegramDraft.$inferSelect,
	clearButtons: (messageId: number) => Promise<void>,
	now = new Date()
) {
	await db
		.update(telegramDraft)
		.set({ status: 'replaced', decidedAt: now })
		.where(and(eq(telegramDraft.id, row.id), eq(telegramDraft.status, 'pending')));
	if (row.messageId) await clearButtons(row.messageId).catch(() => {});
}

// ---------- Simpan ----------

const toStep = (s: StepDraft): StepInput =>
	stepSchema.parse({
		title: s.title,
		dueDate: s.due.slice(0, 10),
		dueTime: s.due.slice(11, 16),
		allDay: false,
		assigneeId: ''
	});

/** Write the proposal through the plan services; returns the result line */
export async function applyStrategyProposal(tx: Tx, chat: StrategyChat, userId: string) {
	const p = chat.proposal;
	if (!p) throw new ServiceError('Belum ada usulan untuk disimpan.');
	if (p.action === 'new_plan') {
		const plan = await createPlan(
			tx,
			planSchema.parse({
				card: `${p.card.kind}:${p.card.id}`,
				goal: p.goal,
				targetDate: p.targetDate
			}),
			userId
		);
		for (const s of p.steps) await addPlanStep(tx, plan.id, toStep(s), userId);
		return `Tersimpan: rencana dengan ${p.steps.length} langkah.`;
	}
	let moved = 0;
	let added = 0;
	for (const s of p.steps) {
		if (s.id) {
			await updateAction(tx, s.id, toStep(s), userId);
			moved++;
		} else {
			await addPlanStep(tx, p.planId, toStep(s), userId);
			added++;
		}
	}
	return `Tersimpan: ${[moved && `${moved} langkah diubah`, added && `${added} langkah ditambahkan`].filter(Boolean).join(', ')}.`;
}

// ---------- Terima / Abaikan on a suggestion ----------

export type SuggestionDecision = { toast: string; html?: string };

async function suggestionRow(db: DbOrTx, id: string) {
	const [s] = await db
		.select({
			id: aiSuggestion.id,
			status: aiSuggestion.status,
			kind: aiSuggestion.kind,
			insight: aiSuggestion.insight,
			proposedAction: aiSuggestion.proposedAction,
			proposedDueAt: aiSuggestion.proposedDueAt,
			clientId: aiSuggestion.clientId,
			dealId: aiSuggestion.dealId,
			projectId: aiSuggestion.projectId,
			dealTitle: deal.title,
			projectName: project.name
		})
		.from(aiSuggestion)
		.leftJoin(deal, eq(deal.id, aiSuggestion.dealId))
		.leftJoin(project, eq(project.id, aiSuggestion.projectId))
		.where(eq(aiSuggestion.id, id));
	return s ? { ...s, cardTitle: s.projectName ?? s.dealTitle } : null;
}

const SUGGESTION_DONE: Record<string, string> = {
	accepted: 'Saran ini sudah diterima.',
	dismissed: 'Saran ini sudah diabaikan.',
	expired: 'Saran ini sudah kedaluwarsa.'
};

/** Terima: the suggestion becomes a step for the sender, on its card or the client's only card */
export async function acceptSuggestionFromChat(
	db: DbOrTx,
	input: { suggestionId: string; userId: string },
	now = new Date()
): Promise<SuggestionDecision> {
	const s = await suggestionRow(db, input.suggestionId);
	if (!s) return { toast: 'Saran tidak ditemukan.' };
	if (s.status !== 'new')
		return { toast: SUGGESTION_DONE[s.status] ?? 'Saran ini sudah diputuskan.' };
	let target: CardRef | undefined;
	if (!s.dealId && !s.projectId) {
		const [deals, projects] = await Promise.all([
			db
				.select({ id: deal.id })
				.from(deal)
				.where(and(eq(deal.clientId, s.clientId), notInArray(deal.stage, ['won', 'lost']))),
			db
				.select({ id: project.id })
				.from(project)
				.where(and(eq(project.clientId, s.clientId), ne(project.stage, 'done')))
		]);
		if (deals.length + projects.length !== 1)
			return {
				toast:
					'Saran ini untuk klien secara umum. Terima di aplikasi dan pilih deal atau proyeknya.'
			};
		target = deals[0] ? { dealId: deals[0].id } : { projectId: projects[0].id };
	}
	try {
		const step = await acceptSuggestion(
			db,
			s.id,
			{ target, assigneeId: input.userId },
			input.userId,
			now
		);
		return {
			toast: 'Langkah ditambahkan.',
			html: `${suggestionHtml(s)}\n\n<b>Diterima:</b> ${esc(step.title)} (${esc(wib(step.dueAt))})`
		};
	} catch (e) {
		if (e instanceof ServiceError) return { toast: e.message.slice(0, 190) };
		throw e;
	}
}

/** Abaikan: kept for the record, like in the app */
export async function dismissSuggestionFromChat(
	db: DbOrTx,
	input: { suggestionId: string; userId: string },
	now = new Date()
): Promise<SuggestionDecision> {
	const s = await suggestionRow(db, input.suggestionId);
	if (!s) return { toast: 'Saran tidak ditemukan.' };
	if (s.status !== 'new')
		return { toast: SUGGESTION_DONE[s.status] ?? 'Saran ini sudah diputuskan.' };
	await dismissSuggestion(db, s.id, input.userId, now);
	return { toast: 'Saran diabaikan.', html: `${suggestionHtml(s)}\n\n<b>Diabaikan.</b>` };
}
