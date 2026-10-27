// Executable plan steps (P2-13). Jalankan prepares a run from the step's payload and today's data;
// Simpan runs it through the existing services and completes the step, in one transaction. The
// data is checked again at both moments: a deal that already moved or an invoice already paid is
// refused. Relative imports only: the Telegram webhook and the web form actions both use it.
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
	CLIENT_SOURCE_LABELS,
	DEAL_STAGE_META,
	DEAL_STAGES,
	INDUSTRY_LABELS,
	INVOICE_STATUS_LABELS,
	TERMINAL_STAGES,
	type ClientSource,
	type DealStage,
	type Industry
} from '../../constants';
import { dayKeyWib, rupiah } from '../../format';
import { addDays } from '../../period';
import { clientSchema } from '../../schemas/client';
import { dealSchema, moveSchema } from '../../schemas/deal';
import { paymentSchema } from '../../schemas/invoice';
import { stepSchema } from '../../schemas/step';
import {
	isRunKind,
	runSchema,
	RUN_KIND_LABELS,
	type RunDraft,
	type RunNext,
	type RunView,
	type StepPayload
} from '../../step-run';
import type { DbOrTx, Tx } from '../db/client';
import { action, category, client, deal, invoice, project, strategyPlan } from '../db/schema/index';
import { completeAction } from './actions';
import { getClientContext, saveClientContext } from './client-context';
import { updateClient } from './clients';
import { createDeal, moveDeal } from './deals';
import { ServiceError } from './errors';
import { recordPayment } from './invoice-payments';
import { invoiceBalance } from './invoice-status';

type Prepared = { run: RunDraft; view: RunView };

/** The step with its client and card */
async function loadStep(db: DbOrTx, stepId: string) {
	const [s] = await db
		.select({
			id: action.id,
			title: action.title,
			kind: action.kind,
			payload: action.payload,
			doneAt: action.doneAt,
			dealId: action.dealId,
			projectId: action.projectId,
			clientId: client.id,
			clientName: client.name,
			archivedAt: client.archivedAt,
			cardTitle: sql<string>`coalesce(${project.name}, ${deal.title})`,
			cardStage: sql<string>`coalesce(${project.stage}::text, ${deal.stage}::text)`
		})
		.from(action)
		.leftJoin(deal, eq(deal.id, action.dealId))
		.leftJoin(project, eq(project.id, action.projectId))
		.innerJoin(client, eq(client.id, sql`coalesce(${deal.clientId}, ${project.clientId})`))
		.where(eq(action.id, stepId));
	if (!s) throw new ServiceError('Langkah tidak ditemukan.');
	if (s.doneAt) throw new ServiceError('Langkah ini sudah selesai.');
	if (!isRunKind(s.kind) || !s.payload)
		throw new ServiceError('Langkah ini pengingat; tidak ada yang dijalankan di sistem.');
	if (s.archivedAt) throw new ServiceError('Klien ini sudah diarsipkan.');
	return { ...s, payload: s.payload };
}

type Step = Awaited<ReturnType<typeof loadStep>>;

/** Is this the last open step of an active card? Then Simpan must add the next one (rule 4). */
async function isLastOpenStep(db: DbOrTx, step: Step) {
	if ((TERMINAL_STAGES as readonly string[]).includes(step.cardStage)) return false;
	const open = await db
		.select({ id: action.id })
		.from(action)
		.where(
			and(
				step.dealId ? eq(action.dealId, step.dealId) : eq(action.projectId, step.projectId!),
				isNull(action.doneAt)
			)
		)
		.limit(2);
	return open.length <= 1;
}

/** `days` WIB calendar days ahead, moved past the weekend */
function workday(now: Date, days: number) {
	let day = addDays(dayKeyWib(now), days);
	const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
	if (weekday === 6) day = addDays(day, 2);
	if (weekday === 0) day = addDays(day, 1);
	return day;
}

const stageLabel = (s: string) => DEAL_STAGE_META[s as DealStage].label;

/** A deal that is closed, or already at (or past) the stage, makes the move stale */
function assertMovable(d: { title: string; stage: DealStage }, to: DealStage) {
	if (d.stage === 'won' || d.stage === 'lost')
		throw new ServiceError(`Deal "${d.title}" sudah ditutup (${stageLabel(d.stage)}).`);
	if (DEAL_STAGES.indexOf(d.stage) >= DEAL_STAGES.indexOf(to))
		throw new ServiceError(
			`Deal "${d.title}" sudah di tahap ${stageLabel(d.stage)}. Langkah ini tidak perlu dijalankan; tandai selesai saja.`
		);
}

const NOT_PAYABLE: Record<string, (n: string) => string> = {
	draft: (n) => `Invoice ${n} belum ditandai terkirim.`,
	paid: (n) => `Invoice ${n} sudah lunas.`,
	void: (n) => `Invoice ${n} sudah dibatalkan.`
};

/** The client's invoice that can still take a payment, with what is left to pay */
async function payableInvoice(
	db: DbOrTx,
	clientId: string,
	where: { id?: string; number?: string }
) {
	const [inv] = await db
		.select()
		.from(invoice)
		.where(
			and(
				eq(invoice.clientId, clientId),
				where.id ? eq(invoice.id, where.id) : eq(invoice.number, where.number ?? '')
			)
		);
	if (!inv)
		throw new ServiceError(`Invoice ${where.number ?? ''} tidak ditemukan untuk klien ini.`);
	const refused = NOT_PAYABLE[inv.status];
	if (refused) throw new ServiceError(refused(inv.number));
	const balance = await invoiceBalance(db, inv);
	if (balance.remaining <= 0) throw new ServiceError(`Invoice ${inv.number} sudah lunas.`);
	return { inv, remaining: balance.remaining };
}

/** Payments land in "Termin" when it exists, like the invoice page's default */
async function paymentCategory(db: DbOrTx) {
	const income = await db
		.select({ id: category.id, name: category.name })
		.from(category)
		.where(and(eq(category.type, 'income'), eq(category.isOverhead, false)))
		.orderBy(asc(category.sort), asc(category.name));
	const c = income.find((x) => x.name === 'Termin') ?? income[0];
	if (!c)
		throw new ServiceError('Belum ada kategori pemasukan. Tambahkan di Pengaturan → Kategori.');
	return c;
}

const PROFILE_KEYS = ['industry', 'source', 'city', 'website', 'notes'] as const;
const PROFILE_LABELS: Record<(typeof PROFILE_KEYS)[number], string> = {
	industry: 'industri',
	source: 'sumber',
	city: 'kota',
	website: 'website',
	notes: 'catatan'
};

/** Jalankan: the run pre-filled from the plan and today's data, and what the preview shows */
export async function prepareStepRun(
	db: DbOrTx,
	stepId: string,
	now = new Date()
): Promise<Prepared> {
	const step = await loadStep(db, stepId);
	const last = await isLastOpenStep(db, step);
	const next: RunNext = last
		? { title: `Tindak lanjut ${step.cardTitle}`.slice(0, 200), due: `${workday(now, 2)}T10:00` }
		: null;
	const view: RunView = {
		stepId: step.id,
		stepTitle: step.title,
		clientId: step.clientId,
		clientName: step.clientName,
		cardTitle: step.cardTitle,
		needsNext: last
	};
	const p: StepPayload = step.payload;
	switch (p.kind) {
		case 'update_client': {
			const [c] = await db
				.select({
					industry: client.industry,
					source: client.source,
					city: client.city,
					website: client.website,
					notes: client.notes
				})
				.from(client)
				.where(eq(client.id, step.clientId));
			const base = {
				industry: c.industry ?? '',
				source: c.source ?? '',
				city: c.city ?? '',
				website: c.website ?? '',
				notes: c.notes ?? ''
			};
			const context = await getClientContext(db, step.clientId);
			return {
				run: {
					kind: p.kind,
					industry: p.industry ?? base.industry,
					source: p.source ?? base.source,
					city: p.city ?? base.city,
					website: p.website ?? base.website,
					notes: p.notes ? [base.notes, p.notes].filter(Boolean).join('\n') : base.notes,
					contextAdd: p.context ?? '',
					base,
					next
				},
				view: { ...view, context: context?.summary ?? null }
			};
		}
		case 'create_deal':
			return {
				run: {
					kind: p.kind,
					title: p.title ?? '',
					valueEstimate: p.value ?? null,
					serviceType: p.serviceType ?? '',
					firstStepTitle: 'Hubungi PIC untuk membahas kebutuhan',
					firstStepDue: `${workday(now, 1)}T10:00`,
					next
				},
				view
			};
		case 'move_deal': {
			const [d] = await db
				.select({ title: deal.title, stage: deal.stage, clientId: deal.clientId })
				.from(deal)
				.where(eq(deal.id, p.dealId));
			if (!d || d.clientId !== step.clientId)
				throw new ServiceError('Deal untuk langkah ini tidak ditemukan.');
			assertMovable(d, p.to);
			return {
				run: { kind: p.kind, dealId: p.dealId, to: p.to as RunDraftOf<'move_deal'>['to'], next },
				view: { ...view, dealTitle: d.title, dealStage: d.stage }
			};
		}
		case 'record_payment': {
			const { inv, remaining } = await payableInvoice(db, step.clientId, {
				number: p.invoiceNumber
			});
			const cat = await paymentCategory(db);
			return {
				run: {
					kind: p.kind,
					invoiceId: inv.id,
					amount: Math.min(p.amount ?? remaining, remaining),
					date: dayKeyWib(now),
					method: 'transfer',
					next
				},
				view: { ...view, invoiceNumber: inv.number, remaining, categoryName: cat.name }
			};
		}
	}
}

type RunDraftOf<K extends RunDraft['kind']> = Extract<RunDraft, { kind: K }>;

const toStepInput = (n: NonNullable<RunNext>) =>
	stepSchema.parse({
		title: n.title,
		dueDate: n.due.slice(0, 10),
		dueTime: n.due.slice(11, 16),
		allDay: false,
		assigneeId: ''
	});

/** A form or chat value that a Zod schema refuses becomes a one-line ServiceError */
function parsed<T>(r: z.ZodSafeParseResult<T>): T {
	if (r.success) return r.data;
	const issue = r.error.issues[0];
	throw new ServiceError(issue?.message ?? 'Data belum lengkap.', String(issue?.path[0] ?? ''));
}

/**
 * Simpan: write the run through the services and tick the step off, in one transaction. Returns
 * the result line ("Deal … pindah ke Proposal.") for the toast or the Telegram message.
 */
export async function executeStepRun(
	db: DbOrTx,
	stepId: string,
	input: unknown,
	userId: string
): Promise<{ line: string; clientId: string }> {
	const run = parsed(runSchema.safeParse(input));
	return db.transaction(async (tx) => {
		// A second Simpan waits here, then finds the step done
		await tx.select({ id: action.id }).from(action).where(eq(action.id, stepId)).for('update');
		const step = await loadStep(tx, stepId);
		if (step.kind !== run.kind) throw new ServiceError('Aksi ini tidak cocok dengan langkahnya.');
		const line = await runAction(tx, step, run);
		await completeAction(tx, stepId, { next: run.next ? toStepInput(run.next) : null }, userId);
		return { line, clientId: step.clientId };
	});

	async function runAction(tx: Tx, step: Step, run: RunDraft): Promise<string> {
		switch (run.kind) {
			case 'update_client': {
				const [c] = await tx
					.select()
					.from(client)
					.where(eq(client.id, step.clientId))
					.for('update');
				// Only what the plan or the person changed; anything else keeps today's value
				const changed = PROFILE_KEYS.filter((k) => run[k] !== run.base[k]);
				if (!changed.length && !run.contextAdd)
					throw new ServiceError('Belum ada data profil yang diubah. Isi dulu data yang kurang.');
				if (changed.length) {
					const value = (k: (typeof PROFILE_KEYS)[number]) =>
						changed.includes(k) ? run[k] : (c[k] ?? '');
					const input = parsed(
						clientSchema.safeParse({
							id: c.id,
							name: c.name,
							status: c.status,
							address: c.address ?? '',
							npwp: c.npwp ?? '',
							ownerId: c.ownerId ?? '',
							industry: value('industry'),
							source: value('source'),
							city: value('city'),
							website: value('website'),
							notes: value('notes')
						})
					);
					await updateClient(tx, c.id, input, userId);
				}
				if (run.contextAdd) {
					const current = await getClientContext(tx, c.id);
					const text = current?.summary.trim()
						? `${current.summary.trim()}\n\n${run.contextAdd}`
						: run.contextAdd;
					await saveClientContext(tx, c.id, text, userId);
				}
				const parts = [
					changed.length && `${changed.map((k) => PROFILE_LABELS[k]).join(', ')} diperbarui`,
					run.contextAdd && 'Ringkasan konteks ditambah'
				].filter(Boolean);
				return `Profil ${step.clientName}: ${parts.join(', ')}.`;
			}
			case 'create_deal': {
				const [same] = await tx
					.select({ id: deal.id })
					.from(deal)
					.where(
						and(
							eq(deal.clientId, step.clientId),
							sql`lower(${deal.title}) = lower(${run.title})`,
							notInArray(deal.stage, ['won', 'lost'])
						)
					);
				if (same) throw new ServiceError(`Deal "${run.title}" sudah ada untuk klien ini.`);
				const row = await createDeal(
					tx,
					parsed(
						dealSchema.safeParse({
							id: '',
							clientId: step.clientId,
							title: run.title,
							serviceType: run.serviceType,
							stage: 'lead',
							valueEstimate: run.valueEstimate,
							expectedClose: '',
							ownerId: '',
							firstStepTitle: run.firstStepTitle,
							firstStepDue: run.firstStepDue
						})
					),
					userId
				);
				return `Deal "${row.title}" dibuat di tahap Lead.`;
			}
			case 'move_deal': {
				const [d] = await tx
					.select({ title: deal.title, stage: deal.stage, clientId: deal.clientId })
					.from(deal)
					.where(eq(deal.id, run.dealId));
				if (!d || d.clientId !== step.clientId)
					throw new ServiceError('Deal untuk langkah ini tidak ditemukan.');
				assertMovable(d, run.to);
				await moveDeal(tx, moveSchema.parse({ id: run.dealId, to: run.to }), null, userId);
				return `Deal "${d.title}" pindah ke ${stageLabel(run.to)}.`;
			}
			case 'record_payment': {
				const { inv, remaining } = await payableInvoice(tx, step.clientId, { id: run.invoiceId });
				if (run.amount > remaining)
					throw new ServiceError(
						`Jumlah melebihi sisa tagihan ${inv.number} (${rupiah(remaining)}).`,
						'amount'
					);
				const cat = await paymentCategory(tx);
				const { status } = await recordPayment(
					tx,
					inv.id,
					parsed(
						paymentSchema.safeParse({
							date: run.date,
							amount: run.amount,
							categoryId: cat.id,
							method: run.method
						})
					),
					userId
				);
				return `Pembayaran ${rupiah(run.amount)} untuk ${inv.number} dicatat (${INVOICE_STATUS_LABELS[status]}).`;
			}
		}
	}
}

/** Open system-action steps of a client, for "Langkah sistem" on Detail Klien */
export function listRunnableSteps(db: DbOrTx, clientId: string) {
	return db
		.select({
			id: action.id,
			title: action.title,
			kind: action.kind,
			dueAt: action.dueAt,
			allDay: action.allDay,
			cardTitle: sql<string>`coalesce(${project.name}, ${deal.title})`,
			planGoal: strategyPlan.goal
		})
		.from(action)
		.leftJoin(deal, eq(deal.id, action.dealId))
		.leftJoin(project, eq(project.id, action.projectId))
		.leftJoin(strategyPlan, eq(strategyPlan.id, action.planId))
		.where(
			and(
				isNull(action.doneAt),
				sql`${action.kind} <> 'reminder'`,
				sql`coalesce(${deal.clientId}, ${project.clientId}) = ${clientId}`
			)
		)
		.orderBy(asc(action.dueAt));
}

export type RunnableStep = Awaited<ReturnType<typeof listRunnableSteps>>[number];

/** "Industri: Logistik", for previews */
export function profileValue(key: (typeof PROFILE_KEYS)[number], value: string) {
	if (!value) return '(kosong)';
	if (key === 'industry') return INDUSTRY_LABELS[value as Industry] ?? value;
	if (key === 'source') return CLIENT_SOURCE_LABELS[value as ClientSource] ?? value;
	return value;
}

export { PROFILE_KEYS, PROFILE_LABELS, RUN_KIND_LABELS };
