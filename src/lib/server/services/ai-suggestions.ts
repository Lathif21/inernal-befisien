// AI suggestions (P2-01, docs/04-ARCHITECTURE.md "AI suggestions"). Relative imports only: the
// Trigger.dev tasks run this. The AI only suggests: nothing is written to deals, plans or steps
// until a person accepts a suggestion.
import { createHash } from 'node:crypto';
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	notInArray,
	sql
} from 'drizzle-orm';
import { z } from 'zod';
import {
	AI_KINDS,
	DEAL_STAGE_META,
	INVOICE_STATUS_LABELS,
	PROJECT_STAGE_META,
	TXN_STATUS_LABELS,
	TXN_TYPE_LABELS,
	type DealStage,
	type ProjectStage
} from '../../constants';
import { dateToWibLocal, wibLocalToDate } from '../../format';
import { addDays } from '../../period';
import { stepSchema } from '../../schemas/step';
import type { AiComplete } from '../ai/client';
import { SUGGEST_SCHEMA, SUGGEST_SYSTEM, suggestUserMessage } from '../ai/prompts/suggest';
import type { DbOrTx } from '../db/client';
import {
	action,
	activity,
	aiSuggestion,
	category,
	client,
	clientContext,
	contact,
	deal,
	invoice,
	project,
	strategyPlan,
	transaction,
	user
} from '../db/schema/index';
import { addAction, type CardRef } from './actions';
import { logActivity } from './activity';
import { ServiceError } from './errors';
import { paidIncome } from './projects';

/** Untouched suggestions expire after this many days (docs/02-DATA-MODEL.md) */
export const SUGGESTION_TTL_DAYS = 7;
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
/** How much history the prompt carries (planned payments are always all there, up to the cap) */
const PAID_TXN_LIMIT = 20;
const PLANNED_TXN_LIMIT = 20;
const INVOICE_LIMIT = 10;
const HISTORY_LIMIT = 5;

/** "2026-10-24 10:00" in WIB; all-day steps as a date only */
const wib = (d: Date | null, allDay = false) =>
	d ? (allDay ? dateToWibLocal(d).slice(0, 10) : dateToWibLocal(d).replace('T', ' ')) : null;
const cut = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Planned income of the outer `project` row (the Keuangan "Direncanakan" rows) */
const plannedIncome = sql<number>`coalesce((
	select sum("transaction"."amount") from ${transaction}
	where "transaction"."project_id" = "project"."id"
		and "transaction"."type" = 'income' and "transaction"."status" = 'planned'
), 0)::bigint`.mapWith(Number);

// ---------- context ----------

/** Clients the daily run looks at: not archived, with an open deal or a running project */
export async function activeClientIds(db: DbOrTx) {
	const rows = await db
		.select({ id: client.id })
		.from(client)
		.where(
			and(
				isNull(client.archivedAt),
				sql`(exists (select 1 from ${deal} where "deal"."client_id" = "client"."id" and "deal"."stage" not in ('won', 'lost'))
				  or exists (select 1 from ${project} where "project"."client_id" = "client"."id" and "project"."stage" <> 'done'))`
			)
		)
		.orderBy(asc(client.name));
	return rows.map((r) => r.id);
}

/**
 * What the AI sees about one client. `facts` holds absolute dates only, so its hash changes only
 * when something real changes (a step, a stage, a payment, an activity), not because a day passed.
 */
export async function buildClientContext(db: DbOrTx, clientId: string) {
	const [c] = await db
		.select({
			id: client.id,
			name: client.name,
			industry: client.industry,
			status: client.status,
			city: client.city,
			notes: client.notes,
			archivedAt: client.archivedAt,
			aiInputHash: client.aiInputHash
		})
		.from(client)
		.where(eq(client.id, clientId));
	if (!c) throw new ServiceError('Klien tidak ditemukan.');

	const [
		deals,
		projects,
		plans,
		steps,
		recent,
		money,
		open,
		contacts,
		txns,
		invoices,
		closedDeals,
		finishedProjects
	] = await Promise.all([
		db
			.select({
				id: deal.id,
				title: deal.title,
				stage: deal.stage,
				value: deal.valueEstimate,
				expectedClose: deal.expectedClose,
				stageChangedAt: deal.stageChangedAt
			})
			.from(deal)
			.where(and(eq(deal.clientId, clientId), notInArray(deal.stage, ['won', 'lost'])))
			.orderBy(asc(deal.createdAt)),
		db
			.select({
				id: project.id,
				name: project.name,
				stage: project.stage,
				contractValue: project.contractValue,
				paid: paidIncome,
				planned: plannedIncome,
				startDate: project.startDate,
				targetEndDate: project.targetEndDate,
				stageChangedAt: project.stageChangedAt
			})
			.from(project)
			.where(and(eq(project.clientId, clientId), ne(project.stage, 'done')))
			.orderBy(asc(project.createdAt)),
		db
			.select({
				id: strategyPlan.id,
				goal: strategyPlan.goal,
				targetDate: strategyPlan.targetDate,
				dealId: strategyPlan.dealId,
				projectId: strategyPlan.projectId,
				done: sql<number>`(select count(*)::int from "action" where "action"."plan_id" = "strategy_plan"."id" and "action"."done_at" is not null)`,
				total: sql<number>`(select count(*)::int from "action" where "action"."plan_id" = "strategy_plan"."id")`
			})
			.from(strategyPlan)
			.where(and(eq(strategyPlan.clientId, clientId), eq(strategyPlan.status, 'active'))),
		db
			.select({
				title: action.title,
				dueAt: action.dueAt,
				allDay: action.allDay,
				doneAt: action.doneAt,
				dealId: action.dealId,
				projectId: action.projectId,
				assignee: user.name
			})
			.from(action)
			.leftJoin(deal, eq(deal.id, action.dealId))
			.leftJoin(project, eq(project.id, action.projectId))
			.leftJoin(user, eq(user.id, action.assigneeId))
			.where(sql`coalesce(${deal.clientId}, ${project.clientId}) = ${clientId}`)
			.orderBy(asc(action.dueAt)),
		db
			.select({ at: activity.occurredAt, type: activity.type, body: activity.body })
			.from(activity)
			.where(eq(activity.clientId, clientId))
			.orderBy(desc(activity.occurredAt), desc(activity.createdAt))
			.limit(10),
		db
			.select({
				paidIn:
					sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = 'income' and ${transaction.status} = 'paid'), 0)::bigint`.mapWith(
						Number
					),
				paidOut:
					sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = 'expense' and ${transaction.status} = 'paid'), 0)::bigint`.mapWith(
						Number
					),
				plannedIn:
					sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = 'income' and ${transaction.status} = 'planned'), 0)::bigint`.mapWith(
						Number
					),
				nextPlanned: sql<
					string | null
				>`min(${transaction.date}) filter (where ${transaction.type} = 'income' and ${transaction.status} = 'planned')`
			})
			.from(transaction)
			.where(eq(transaction.clientId, clientId)),
		db
			.select({ kind: aiSuggestion.kind, action: aiSuggestion.proposedAction })
			.from(aiSuggestion)
			.where(and(eq(aiSuggestion.clientId, clientId), eq(aiSuggestion.status, 'new'))),
		// Names and roles only: phone numbers and emails are not sent to the model
		db
			.select({ name: contact.name, position: contact.position, isPrimary: contact.isPrimary })
			.from(contact)
			.where(eq(contact.clientId, clientId))
			.orderBy(desc(contact.isPrimary), asc(contact.name)),
		db
			.select({
				date: transaction.date,
				type: transaction.type,
				status: transaction.status,
				amount: transaction.amount,
				description: transaction.description,
				category: category.name,
				project: project.name,
				invoice: invoice.number
			})
			.from(transaction)
			.leftJoin(category, eq(category.id, transaction.categoryId))
			.leftJoin(project, eq(project.id, transaction.projectId))
			.leftJoin(invoice, eq(invoice.id, transaction.invoiceId))
			.where(and(eq(transaction.clientId, clientId), ne(transaction.status, 'cancelled')))
			.orderBy(desc(transaction.date), desc(transaction.createdAt), desc(transaction.id)),
		db
			.select({
				number: invoice.number,
				status: invoice.status,
				issueDate: invoice.issueDate,
				dueDate: invoice.dueDate,
				total: invoice.total,
				project: project.name
			})
			.from(invoice)
			.leftJoin(project, eq(project.id, invoice.projectId))
			.where(and(eq(invoice.clientId, clientId), ne(invoice.status, 'void')))
			.orderBy(desc(invoice.issueDate), desc(invoice.number))
			.limit(INVOICE_LIMIT),
		db
			.select({
				title: deal.title,
				stage: deal.stage,
				value: deal.valueEstimate,
				lostReason: deal.lostReason,
				wonAt: deal.wonAt,
				lostAt: deal.lostAt
			})
			.from(deal)
			.where(and(eq(deal.clientId, clientId), inArray(deal.stage, ['won', 'lost'])))
			.orderBy(desc(deal.stageChangedAt))
			.limit(HISTORY_LIMIT),
		db
			.select({
				name: project.name,
				contractValue: project.contractValue,
				paid: paidIncome,
				finishedAt: project.finishedAt
			})
			.from(project)
			.where(
				and(
					eq(project.clientId, clientId),
					eq(project.stage, 'done'),
					isNotNull(project.finishedAt)
				)
			)
			.orderBy(desc(project.finishedAt))
			.limit(HISTORY_LIMIT)
	]);

	// The long memory: the whole history condensed (services/client-context.ts)
	const [summary] = await db
		.select({ text: clientContext.summary })
		.from(clientContext)
		.where(eq(clientContext.clientId, clientId));

	const planned = txns.filter((t) => t.status === 'planned').slice(-PLANNED_TXN_LIMIT);
	const paid = txns.filter((t) => t.status === 'paid').slice(0, PAID_TXN_LIMIT);

	const stepsOf = (ref: { dealId?: string; projectId?: string }) => {
		const mine = steps.filter((s) =>
			ref.dealId ? s.dealId === ref.dealId : s.projectId === ref.projectId
		);
		return {
			langkah_terbuka: mine
				.filter((s) => !s.doneAt)
				.map((s) => ({ judul: s.title, jatuh_tempo: wib(s.dueAt, s.allDay), pic: s.assignee })),
			langkah_selesai_terakhir: mine
				.filter((s) => s.doneAt)
				.sort((a, b) => +b.doneAt! - +a.doneAt!)
				.slice(0, 3)
				.map((s) => ({ judul: s.title, selesai: wib(s.doneAt) }))
		};
	};

	const facts = {
		klien: {
			nama: c.name,
			industri: c.industry,
			status: c.status,
			kota: c.city,
			catatan: cut(c.notes, 500)
		},
		ringkasan_konteks: summary?.text ?? null,
		deal_terbuka: deals.map((d) => ({
			id: d.id,
			judul: d.title,
			tahap: DEAL_STAGE_META[d.stage as DealStage].label,
			di_tahap_ini_sejak: wib(d.stageChangedAt),
			nilai_rp: d.value,
			target_closing: d.expectedClose,
			...stepsOf({ dealId: d.id })
		})),
		proyek_berjalan: projects.map((p) => ({
			id: p.id,
			nama: p.name,
			tahap: PROJECT_STAGE_META[p.stage as ProjectStage].label,
			di_tahap_ini_sejak: wib(p.stageChangedAt),
			nilai_kontrak_rp: p.contractValue,
			sudah_dibayar_rp: p.paid,
			pembayaran_direncanakan_rp: p.planned,
			// Contract left with neither a payment nor a planned one in Keuangan
			belum_dijadwalkan_rp:
				p.contractValue == null ? null : Math.max(0, p.contractValue - p.paid - p.planned),
			mulai: p.startDate,
			target_selesai: p.targetEndDate,
			...stepsOf({ projectId: p.id })
		})),
		rencana_aktif: plans.map((p) => ({
			tujuan: p.goal,
			target: p.targetDate,
			untuk_id: p.projectId ?? p.dealId,
			langkah_selesai: `${p.done}/${p.total}`
		})),
		aktivitas_terakhir: recent.map((a) => ({
			waktu: wib(a.at),
			jenis: a.type,
			isi: cut(a.body, 200)
		})),
		keuangan: {
			pemasukan_dibayar_rp: money[0]?.paidIn ?? 0,
			pengeluaran_dibayar_rp: money[0]?.paidOut ?? 0,
			pemasukan_direncanakan_rp: money[0]?.plannedIn ?? 0,
			pemasukan_direncanakan_berikutnya: money[0]?.nextPlanned ?? null
		},
		// Oldest planned first (what is due next), newest paid first
		transaksi_direncanakan: [...planned].reverse().map(txnFact),
		transaksi_dibayar_terakhir: paid.map(txnFact),
		invoice: invoices.map((i) => ({
			nomor: i.number,
			status: INVOICE_STATUS_LABELS[i.status],
			terbit: i.issueDate,
			jatuh_tempo: i.dueDate,
			total_rp: i.total,
			proyek: i.project
		})),
		kontak: contacts.map((k) => ({ nama: k.name, jabatan: k.position, utama: k.isPrimary })),
		deal_selesai_terakhir: closedDeals.map((d) => ({
			judul: d.title,
			hasil: DEAL_STAGE_META[d.stage as DealStage].label,
			tanggal: wib(d.wonAt ?? d.lostAt, true),
			nilai_rp: d.value,
			alasan_kalah: cut(d.lostReason, 200)
		})),
		proyek_selesai_terakhir: finishedProjects.map((p) => ({
			nama: p.name,
			selesai: wib(p.finishedAt, true),
			nilai_kontrak_rp: p.contractValue,
			sudah_dibayar_rp: p.paid
		}))
	};
	const hash = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
	const targets = new Map<string, CardRef>([
		...deals.map((d) => [d.id, { dealId: d.id }] as const),
		...projects.map((p) => [p.id, { projectId: p.id }] as const)
	]);
	return {
		client: c,
		facts,
		hash,
		targets,
		/** Open suggestions go to the prompt (no repeats) but not into the hash */
		openSuggestions: open.map((o) => ({ jenis: o.kind, tindakan: o.action }))
	};
}

type TxnRow = {
	date: string;
	type: 'income' | 'expense';
	status: string;
	amount: number;
	description: string | null;
	category: string | null;
	project: string | null;
	invoice: string | null;
};

/** One Keuangan row as the AI sees it; `proyek` null = not linked to a project */
function txnFact(t: TxnRow) {
	return {
		tanggal: t.date,
		jenis: TXN_TYPE_LABELS[t.type].long,
		status: TXN_STATUS_LABELS[t.status as keyof typeof TXN_STATUS_LABELS],
		jumlah_rp: t.amount,
		kategori: t.category,
		keterangan: cut(t.description, 120),
		proyek: t.project,
		invoice: t.invoice
	};
}

// ---------- generate ----------

const aiAnswer = z.object({
	suggestions: z
		.array(
			z.object({
				kind: z.enum(AI_KINDS),
				// "" (or null from models that send it) = none
				target_id: z
					.string()
					.nullable()
					.transform((v) => v?.trim() || null),
				insight: z.string().trim().min(5).max(800),
				proposed_action: z.string().trim().min(3).max(300),
				proposed_due_at: z
					.string()
					.nullable()
					.transform((v) => v?.trim() || null)
			})
		)
		.max(3)
});

export type GenerateOptions = {
	complete: AiComplete;
	now?: Date;
	/** Ask even when nothing changed (Minta saran AI) */
	force?: boolean;
	/** Ask about one plan; its suggestions carry plan_id and older ones are kept */
	planId?: string;
};

export type GenerateResult =
	| { status: 'skipped'; clientId: string }
	| {
			status: 'created';
			clientId: string;
			count: number;
			model: string;
			usage: { input: number; output: number } | null;
	  };

/** "Sabtu, 24 Okt 2026 09:00 WIB (2026-10-24T09:00)" */
function nowLine(now: Date) {
	const local = dateToWibLocal(now);
	const day = new Date(`${local.slice(0, 10)}T00:00:00Z`).getUTCDay();
	return `${DAYS[day]}, ${local.replace('T', ' ')} WIB (${local})`;
}

/**
 * One client: build the context, skip when the facts are unchanged since the last run (unless
 * forced), ask the AI, validate, and store up to 3 suggestions. New suggestions replace the
 * client's older open ones (a plan request adds to them instead).
 */
export async function generateSuggestions(
	db: DbOrTx,
	clientId: string,
	opts: GenerateOptions
): Promise<GenerateResult> {
	const now = opts.now ?? new Date();
	const ctx = await buildClientContext(db, clientId);
	if (ctx.client.archivedAt) throw new ServiceError('Klien ini sudah diarsipkan.');
	if (!opts.force && ctx.client.aiInputHash === ctx.hash) return { status: 'skipped', clientId };

	let focus: string | undefined;
	if (opts.planId) {
		const [plan] = await db
			.select({ goal: strategyPlan.goal, clientId: strategyPlan.clientId })
			.from(strategyPlan)
			.where(eq(strategyPlan.id, opts.planId));
		if (!plan || plan.clientId !== clientId) throw new ServiceError('Rencana tidak ditemukan.');
		focus = `saran untuk mencapai rencana "${plan.goal}".`;
	}

	const answer = await opts.complete({
		system: SUGGEST_SYSTEM,
		user: suggestUserMessage(
			{ sekarang: nowLine(now), ...ctx.facts, saran_terbuka: ctx.openSuggestions },
			focus
		),
		schema: SUGGEST_SCHEMA,
		schemaName: 'saran_ai'
	});
	// Some models (MiniMax) return the bare list instead of { suggestions: [...] }
	const parsed = aiAnswer.safeParse(
		Array.isArray(answer.json) ? { suggestions: answer.json } : answer.json
	);
	if (!parsed.success)
		throw new Error(`AI answer does not match the schema: ${parsed.error.message}`);

	const latest = new Date(now.getTime() + 60 * 86_400_000);
	const rows = parsed.data.suggestions.map((s) => {
		const target = s.target_id ? ctx.targets.get(s.target_id) : undefined;
		// A time the model got wrong (past, too far, not a date) is dropped, not guessed
		const due = s.proposed_due_at ? wibLocalToDate(s.proposed_due_at.slice(0, 16)) : null;
		return {
			clientId,
			dealId: target?.dealId ?? null,
			projectId: target?.projectId ?? null,
			planId: opts.planId ?? null,
			kind: s.kind,
			insight: s.insight,
			proposedAction: s.proposed_action.slice(0, 200),
			proposedDueAt: due && due > now && due < latest ? due : null,
			model: answer.model,
			inputHash: ctx.hash
		};
	});

	await db.transaction(async (tx) => {
		if (!opts.planId)
			await tx
				.update(aiSuggestion)
				.set({ status: 'expired' })
				.where(and(eq(aiSuggestion.clientId, clientId), eq(aiSuggestion.status, 'new')));
		if (rows.length) await tx.insert(aiSuggestion).values(rows);
		await tx
			.update(client)
			.set({ aiInputHash: ctx.hash, aiCheckedAt: now })
			.where(eq(client.id, clientId));
	});
	return {
		status: 'created',
		clientId,
		count: rows.length,
		model: answer.model,
		usage: answer.usage
	};
}

// ---------- decide ----------

async function openSuggestion(db: DbOrTx, id: string) {
	const [s] = await db.select().from(aiSuggestion).where(eq(aiSuggestion.id, id)).for('update');
	if (!s) throw new ServiceError('Saran tidak ditemukan.');
	if (s.status !== 'new')
		throw new ServiceError(
			s.status === 'expired' ? 'Saran ini sudah kedaluwarsa.' : 'Saran ini sudah diputuskan.'
		);
	return s;
}

export type AcceptInput = {
	/** Step title; default = the proposed action */
	title?: string;
	/** WIB wall time `yyyy-MM-ddTHH:mm`; default = proposed time, else tomorrow 09:00 */
	dueAt?: string;
	/** A step for the whole day (dueAt's time is ignored) */
	allDay?: boolean;
	/** Required when the suggestion is about the client in general */
	target?: CardRef;
	assigneeId?: string;
	/** Put the step into this plan */
	planId?: string | null;
};

/**
 * "Tambahkan ke rencana" / "Buat langkah": the suggestion becomes a step (with from_suggestion_id)
 * on its deal or project, the suggestion is marked accepted, and the timeline records it.
 */
export async function acceptSuggestion(
	db: DbOrTx,
	id: string,
	input: AcceptInput,
	userId: string,
	now = new Date()
) {
	return db.transaction(async (tx) => {
		const s = await openSuggestion(tx, id);
		const ref: CardRef | null =
			input.target ??
			(s.dealId ? { dealId: s.dealId } : s.projectId ? { projectId: s.projectId } : null);
		if (!ref) throw new ServiceError('Pilih deal atau proyek untuk langkah ini.', 'target');

		const local =
			input.dueAt ??
			(s.proposedDueAt
				? dateToWibLocal(s.proposedDueAt)
				: `${addDays(dateToWibLocal(now).slice(0, 10), 1)}T09:00`);
		const step = stepSchema.safeParse({
			title: (input.title ?? s.proposedAction).slice(0, 200),
			dueDate: local.slice(0, 10),
			dueTime: input.allDay ? '' : local.slice(11, 16),
			allDay: input.allDay ?? false,
			assigneeId: input.assigneeId ?? ''
		});
		if (!step.success) throw new ServiceError(step.error.issues[0].message, 'step');

		const planId = input.planId === undefined ? s.planId : input.planId;
		const created = await addAction(tx, ref, step.data, userId, { planId });
		await tx.update(action).set({ fromSuggestionId: s.id }).where(eq(action.id, created.id));
		await tx
			.update(aiSuggestion)
			.set({ status: 'accepted', decidedBy: userId, decidedAt: now })
			.where(eq(aiSuggestion.id, s.id));
		await logActivity(tx, {
			clientId: s.clientId,
			dealId: ref.dealId ?? null,
			projectId: ref.projectId ?? null,
			type: 'ai_accepted',
			body: `Saran AI diterima: ${created.title}`,
			meta: { suggestionId: s.id, kind: s.kind, actionId: created.id },
			userId
		});
		return created;
	});
}

/** "Abaikan": kept for the record, logged on the timeline */
export async function dismissSuggestion(db: DbOrTx, id: string, userId: string, now = new Date()) {
	return db.transaction(async (tx) => {
		const s = await openSuggestion(tx, id);
		await tx
			.update(aiSuggestion)
			.set({ status: 'dismissed', decidedBy: userId, decidedAt: now })
			.where(eq(aiSuggestion.id, s.id));
		await logActivity(tx, {
			clientId: s.clientId,
			dealId: s.dealId,
			projectId: s.projectId,
			type: 'system',
			body: `Saran AI diabaikan: ${s.proposedAction}`,
			meta: { suggestionId: s.id, kind: s.kind },
			userId
		});
	});
}

/** Daily clean-up (ai-expire-suggestions): untouched suggestions older than 7 days */
export async function expireSuggestions(db: DbOrTx, now = new Date()) {
	const cutoff = new Date(now.getTime() - SUGGESTION_TTL_DAYS * 86_400_000);
	const rows = await db
		.update(aiSuggestion)
		.set({ status: 'expired' })
		.where(and(eq(aiSuggestion.status, 'new'), lt(aiSuggestion.createdAt, cutoff)))
		.returning({ id: aiSuggestion.id });
	return rows.length;
}

/** Open suggestions with their client and card names (Strategi, client page) */
export function listOpenSuggestions(db: DbOrTx, f: { clientId?: string; planId?: string } = {}) {
	return db
		.select({
			id: aiSuggestion.id,
			kind: aiSuggestion.kind,
			insight: aiSuggestion.insight,
			proposedAction: aiSuggestion.proposedAction,
			proposedDueAt: aiSuggestion.proposedDueAt,
			createdAt: aiSuggestion.createdAt,
			clientId: aiSuggestion.clientId,
			clientName: client.name,
			dealId: aiSuggestion.dealId,
			projectId: aiSuggestion.projectId,
			planId: aiSuggestion.planId,
			cardTitle: sql<string | null>`coalesce(${project.name}, ${deal.title})`
		})
		.from(aiSuggestion)
		.innerJoin(client, eq(client.id, aiSuggestion.clientId))
		.leftJoin(deal, eq(deal.id, aiSuggestion.dealId))
		.leftJoin(project, eq(project.id, aiSuggestion.projectId))
		.where(
			and(
				eq(aiSuggestion.status, 'new'),
				isNull(client.archivedAt),
				f.clientId ? eq(aiSuggestion.clientId, f.clientId) : undefined,
				f.planId ? eq(aiSuggestion.planId, f.planId) : undefined
			)
		)
		.orderBy(desc(aiSuggestion.createdAt));
}

export type OpenSuggestion = Awaited<ReturnType<typeof listOpenSuggestions>>[number];

/** How many suggestions are waiting (for the digest's "x saran AI baru") */
export async function countOpenSuggestions(db: DbOrTx, clientIds?: string[]) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(aiSuggestion)
		.where(
			and(
				eq(aiSuggestion.status, 'new'),
				clientIds?.length ? inArray(aiSuggestion.clientId, clientIds) : undefined
			)
		);
	return n;
}
