// Executable steps on Telegram (P2-13). Jalankan (`x:<stepId>`) under a saved strategy plan sends a
// preview with Simpan / Batal; a reply completes or corrects it (the cheap model fills the fields),
// and Simpan runs it through services/step-runs.ts. One open run per chat, for 30 minutes.
// Relative imports only: the webhook starts and saves runs, the Trigger.dev task revises them.
import { and, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import {
	CLIENT_SOURCES,
	DEAL_STAGE_META,
	INDUSTRIES,
	OPEN_DEAL_STAGES,
	PAYMENT_METHOD_LABELS,
	PAYMENT_METHODS,
	SERVICE_TYPE_LABELS,
	SERVICE_TYPES,
	type ServiceType
} from '../../constants';
import { dateID, dateToWibLocal, rupiah, wibLocalToDate } from '../../format';
import {
	RUN_KIND_LABELS,
	runProblem,
	type RunDraft,
	type RunNext,
	type RunView
} from '../../step-run';
import type { AiComplete } from '../ai/client';
import {
	STEP_RUN_FIELDS,
	STEP_RUN_SCHEMA,
	STEP_RUN_SYSTEM,
	stepRunUserMessage,
	type StepRunField
} from '../ai/prompts/step-run';
import type { DbOrTx, Tx } from '../db/client';
import { telegramDraft } from '../db/schema/index';
import { escapeHtml, type TelegramButton } from '../notify/telegram';
import { ServiceError } from './errors';
import { executeStepRun, prepareStepRun, PROFILE_KEYS, profileValue } from './step-runs';

/** `telegram_draft.kind` of a Jalankan preview */
export const STEP_RUN = 'step_run';
export const RUN_MINUTES = 30;

/** `telegram_draft.payload` of a Jalankan preview */
export type StepRunPayload = { run: RunDraft; view: RunView };

const esc = escapeHtml;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const when = (due: string) =>
	wibLocalToDate(due) ? `${dateID(due.slice(0, 10), 'long')} ${due.slice(11, 16)} WIB` : due;
const stage = (s: string | undefined) =>
	s ? (DEAL_STAGE_META[s as keyof typeof DEAL_STAGE_META]?.label ?? s) : '';

const PROFILE_TITLES: Record<(typeof PROFILE_KEYS)[number], string> = {
	industry: 'Industri',
	source: 'Sumber',
	city: 'Kota',
	website: 'Website',
	notes: 'Catatan'
};

/** The run as the preview shows it: what changes, with the state before */
export function stepRunHtml({ run, view }: StepRunPayload) {
	const lines = [
		`<b>Jalankan · ${esc(RUN_KIND_LABELS[run.kind])}</b>`,
		`${esc(view.clientName)} · ${esc(view.cardTitle)}`,
		`Langkah: ${esc(view.stepTitle)}`,
		''
	];
	switch (run.kind) {
		case 'update_client': {
			for (const k of PROFILE_KEYS) {
				const value = esc(cut(profileValue(k, run[k]), 300));
				lines.push(
					run[k] === run.base[k]
						? `${PROFILE_TITLES[k]}: ${value}`
						: `${PROFILE_TITLES[k]}: ${esc(cut(profileValue(k, run.base[k]), 80))} → <b>${value}</b>`
				);
			}
			lines.push(
				`Tambahan Ringkasan konteks: ${run.contextAdd ? `<b>${esc(cut(run.contextAdd, 600))}</b>` : '(belum ada)'}`
			);
			break;
		}
		case 'create_deal':
			lines.push(
				`Judul deal: ${run.title ? `<b>${esc(run.title)}</b>` : '(belum diisi)'}`,
				`Nilai: ${run.valueEstimate !== null ? rupiah(run.valueEstimate) : '(belum diisi)'}`,
				`Layanan: ${run.serviceType ? esc(SERVICE_TYPE_LABELS[run.serviceType as ServiceType]) : '(belum diisi)'}`,
				`Langkah pertama deal: ${esc(run.firstStepTitle)} (${esc(when(run.firstStepDue))})`
			);
			break;
		case 'move_deal':
			lines.push(
				`Deal <b>${esc(view.dealTitle ?? '')}</b>: ${esc(stage(view.dealStage))} → <b>${esc(stage(run.to))}</b>`
			);
			break;
		case 'record_payment':
			lines.push(
				`Invoice <b>${esc(view.invoiceNumber ?? '')}</b> · sisa ${rupiah(view.remaining ?? 0)}`,
				`Jumlah: <b>${rupiah(run.amount)}</b>`,
				`Tanggal: ${/^\d{4}-\d{2}-\d{2}$/.test(run.date) ? dateID(run.date, 'long') : esc(run.date)}`,
				`Metode: ${PAYMENT_METHOD_LABELS[run.method]}`,
				`Kategori: ${esc(view.categoryName ?? '')}`
			);
			break;
	}
	if (run.next)
		lines.push('', `Langkah berikutnya: ${esc(run.next.title)} (${esc(when(run.next.due))})`);
	return lines.join('\n');
}

const EXAMPLE: Partial<Record<RunDraft['kind'], string>> = {
	update_client: ', misalnya "industrinya logistik, kota Surabaya, butuh ERP gudang"',
	create_deal: ', misalnya "judulnya Integrasi ERP, nilai 150 juta"',
	record_payment: ', misalnya "jumlahnya 12 juta, dibayar kemarin"'
};

function previewHtml(p: StepRunPayload) {
	const problem = runProblem(p.run);
	return [
		stepRunHtml(p),
		...(problem ? ['', `<i>Belum bisa disimpan: ${esc(problem)}</i>`] : []),
		'',
		`<i>Periksa lalu tekan Simpan (berlaku ${RUN_MINUTES} menit). Ada yang kurang atau salah? Balas dengan datanya${EXAMPLE[p.run.kind] ?? ''}.</i>`
	].join('\n');
}

const buttons = (draftId: string): TelegramButton[] => [
	{ text: 'Simpan', data: `s:${draftId}` },
	{ text: 'Batal', data: `c:${draftId}` }
];

type Deps = {
	send: (html: string, buttons?: TelegramButton[]) => Promise<number>;
	clearButtons: (messageId: number) => Promise<void>;
};

/** Jalankan: prepare the run and send its preview. An older open run in this chat is replaced. */
export async function startStepRun(
	db: DbOrTx,
	input: { stepId: string; chatId: string; userId: string },
	deps: Deps,
	now = new Date()
): Promise<{ toast: string }> {
	let prepared: StepRunPayload;
	try {
		prepared = await prepareStepRun(db, input.stepId, now);
	} catch (e) {
		if (e instanceof ServiceError) return { toast: e.message.slice(0, 190) };
		throw e;
	}
	const old = await db
		.update(telegramDraft)
		.set({ status: 'replaced', decidedAt: now })
		.where(
			and(
				eq(telegramDraft.chatId, input.chatId),
				eq(telegramDraft.kind, STEP_RUN),
				eq(telegramDraft.status, 'pending')
			)
		)
		.returning({ messageId: telegramDraft.messageId });
	for (const o of old) if (o.messageId) await deps.clearButtons(o.messageId).catch(() => {});

	const [row] = await db
		.insert(telegramDraft)
		.values({
			userId: input.userId,
			chatId: input.chatId,
			kind: STEP_RUN,
			payload: prepared as unknown as Record<string, unknown>,
			answer: {},
			source: 'text',
			input: '',
			expiresAt: new Date(now.getTime() + RUN_MINUTES * 60_000),
			// App clock: now() is frozen inside a transaction, and "the open run" is the newest one
			createdAt: new Date()
		})
		.returning({ id: telegramDraft.id });
	const messageId = await deps.send(previewHtml(prepared), buttons(row.id));
	await db.update(telegramDraft).set({ messageId }).where(eq(telegramDraft.id, row.id));
	return { toast: 'Periksa lalu tekan Simpan.' };
}

/** The open Jalankan preview of this chat (newest, not expired), if any */
export async function openStepRun(db: DbOrTx, chatId: string, now: Date) {
	const [row] = await db
		.select()
		.from(telegramDraft)
		.where(
			and(
				eq(telegramDraft.chatId, chatId),
				eq(telegramDraft.kind, STEP_RUN),
				eq(telegramDraft.status, 'pending'),
				gt(telegramDraft.expiresAt, now)
			)
		)
		.orderBy(desc(telegramDraft.createdAt))
		.limit(1);
	return row ?? null;
}

// ---------- a correction by chat ----------

/** The run's fields as the AI sees them (flat strings) */
export function fieldsOf(run: RunDraft): Partial<Record<StepRunField, string>> {
	const next = run.next ? { next_title: run.next.title, next_due: run.next.due } : {};
	switch (run.kind) {
		case 'update_client':
			return {
				industry: run.industry,
				source: run.source,
				city: run.city,
				website: run.website,
				notes: run.notes,
				context_add: run.contextAdd,
				...next
			};
		case 'create_deal':
			return {
				title: run.title,
				value: run.valueEstimate === null ? '' : String(run.valueEstimate),
				service_type: run.serviceType,
				first_step_title: run.firstStepTitle,
				first_step_due: run.firstStepDue,
				...next
			};
		case 'move_deal':
			return { to: run.to, ...next };
		case 'record_payment':
			return { amount: String(run.amount), date: run.date, method: run.method, ...next };
	}
}

const amount = (v: string) => {
	const n = Number(v.replace(/\D/g, ''));
	return v.trim() && Number.isFinite(n) ? n : null;
};
/** A choice outside the list keeps the old value */
const pick = <T extends string>(v: string, list: readonly T[], old: T): T =>
	(list as readonly string[]).includes(v) ? (v as T) : old;
const pickOrEmpty = (v: string, list: readonly string[], old: string) =>
	v === '' || list.includes(v) ? v : old;

/** The AI's fields applied to the run; checking the result is left to `runSchema` */
export function applyFields(run: RunDraft, a: Record<StepRunField, string>): RunDraft {
	const next: RunNext = run.next
		? {
				title: a.next_title.trim() || run.next.title,
				due: a.next_due.trim().replace(' ', 'T') || run.next.due
			}
		: null;
	switch (run.kind) {
		case 'update_client':
			return {
				...run,
				industry: pickOrEmpty(a.industry, INDUSTRIES, run.industry),
				source: pickOrEmpty(a.source, CLIENT_SOURCES, run.source),
				city: a.city.trim(),
				website: a.website.trim(),
				notes: a.notes.trim(),
				contextAdd: a.context_add.trim(),
				next
			};
		case 'create_deal':
			return {
				...run,
				title: a.title.trim(),
				valueEstimate: amount(a.value),
				serviceType: pickOrEmpty(a.service_type, SERVICE_TYPES, run.serviceType),
				firstStepTitle: a.first_step_title.trim() || run.firstStepTitle,
				firstStepDue: a.first_step_due.trim().replace(' ', 'T') || run.firstStepDue,
				next
			};
		case 'move_deal':
			return { ...run, to: pick(a.to, OPEN_DEAL_STAGES, run.to), next };
		case 'record_payment':
			return {
				...run,
				amount: amount(a.amount) ?? run.amount,
				date: a.date.trim() || run.date,
				method: pick(a.method, PAYMENT_METHODS, run.method),
				next
			};
	}
}

const answerSchema = z.object({
	leave: z.boolean().catch(false),
	reply: z.string().catch(''),
	...Object.fromEntries(STEP_RUN_FIELDS.map((f) => [f, z.string().catch('')]))
}) as unknown as z.ZodType<{ leave: boolean; reply: string } & Record<StepRunField, string>>;

const nowLine = (now: Date) =>
	`${dateID(now, 'long')} ${dateID(now, 'time')} WIB (${dateToWibLocal(now)})`;

/**
 * A message while a Jalankan preview is open: the AI applies it to the run and a new preview
 * replaces the old one. A message about something else comes back as 'left' and changes nothing.
 */
export async function reviseStepRun(
	db: DbOrTx,
	row: typeof telegramDraft.$inferSelect,
	input: { text: string; quote: string },
	deps: Deps & { complete: AiComplete },
	now = new Date()
): Promise<'revised' | 'left'> {
	const current = row.payload as unknown as StepRunPayload;
	const res = await deps.complete({
		system: STEP_RUN_SYSTEM,
		user: stepRunUserMessage({
			now: nowLine(now),
			kind: current.run.kind,
			label: RUN_KIND_LABELS[current.run.kind],
			values: fieldsOf(current.run),
			message: input.text
		}),
		schema: STEP_RUN_SCHEMA,
		schemaName: 'aksi_langkah',
		maxTokens: 4000
	});
	const a = answerSchema.parse(res.json ?? {});
	if (a.leave) return 'left';

	const next: StepRunPayload = { ...current, run: applyFields(current.run, a) };
	if (row.messageId) await deps.clearButtons(row.messageId).catch(() => {});
	const reply = a.reply.trim();
	const messageId = await deps.send(
		`${input.quote}${reply ? `${esc(reply)}\n\n` : ''}${previewHtml(next)}`,
		buttons(row.id)
	);
	await db
		.update(telegramDraft)
		.set({
			payload: next as unknown as Record<string, unknown>,
			input: input.text,
			messageId,
			expiresAt: new Date(now.getTime() + RUN_MINUTES * 60_000)
		})
		.where(eq(telegramDraft.id, row.id));
	return 'revised';
}

// ---------- Simpan / Batal (called by confirmDraft / cancelDraft) ----------

/** Simpan inside confirmDraft's transaction; a rule the CRM refuses leaves the preview open */
export async function confirmStepRun(
	tx: Tx,
	d: typeof telegramDraft.$inferSelect,
	now: Date
): Promise<{ toast: string; html?: string }> {
	const p = d.payload as unknown as StepRunPayload;
	if (d.status !== 'pending')
		return {
			toast: d.status === 'saved' ? 'Aksi ini sudah dijalankan.' : 'Pratinjau ini sudah ditutup.'
		};
	if (d.expiresAt <= now)
		return {
			toast: 'Pratinjau sudah kedaluwarsa.',
			html: `${stepRunHtml(p)}\n\n<b>Kedaluwarsa.</b> Tekan Jalankan lagi di rencana.`
		};
	const { line } = await executeStepRun(tx, p.view.stepId, p.run, d.userId);
	await tx
		.update(telegramDraft)
		.set({ status: 'saved', decidedAt: now })
		.where(eq(telegramDraft.id, d.id));
	return {
		toast: 'Tersimpan.',
		html: `${stepRunHtml(p)}\n\n<b>${esc(line)}</b> Langkahnya ditandai selesai.`
	};
}

export function cancelledStepRunHtml(d: typeof telegramDraft.$inferSelect) {
	return `${stepRunHtml(d.payload as unknown as StepRunPayload)}\n\n<b>Dibatalkan.</b> Tidak ada yang disimpan; langkahnya tetap terbuka.`;
}
