// "Ringkasan konteks" per client (client feedback): the AI condenses the whole history (every deal
// with its outcome, every note and stage change, contacts, payments) into a short summary that
// the team can edit and the daily suggestions read. Relative imports only: Trigger.dev runs this.
import { createHash } from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	DEAL_STAGE_META,
	PROJECT_STAGE_META,
	type DealStage,
	type ProjectStage
} from '../../constants';
import { dateToWibLocal } from '../../format';
import type { AiComplete } from '../ai/client';
import { CONTEXT_SCHEMA, CONTEXT_SYSTEM, contextUserMessage } from '../ai/prompts/client-context';
import type { DbOrTx } from '../db/client';
import {
	activity,
	client,
	clientContext,
	contact,
	deal,
	invoice,
	project,
	transaction,
	user
} from '../db/schema/index';
import { ServiceError } from './errors';
import { paidIncome } from './projects';

/** Newest timeline entries the summary reads (older ones live on in the previous summary) */
const HISTORY_LIMIT = 200;
export const CONTEXT_MAX_LENGTH = 4000;

const day = (d: Date | null) => (d ? dateToWibLocal(d).slice(0, 10) : null);
const cut = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function getClientContext(db: DbOrTx, clientId: string) {
	const [row] = await db
		.select({
			summary: clientContext.summary,
			source: clientContext.source,
			updatedAt: clientContext.updatedAt,
			updatedByName: user.name
		})
		.from(clientContext)
		.leftJoin(user, eq(user.id, clientContext.updatedBy))
		.where(eq(clientContext.clientId, clientId));
	return row ?? null;
}

export type ClientContext = NonNullable<Awaited<ReturnType<typeof getClientContext>>>;

/** Everything the summary is written from; `hash` leaves the previous summary out */
export async function buildHistory(db: DbOrTx, clientId: string) {
	const [c] = await db
		.select({
			name: client.name,
			industry: client.industry,
			city: client.city,
			notes: client.notes,
			archivedAt: client.archivedAt
		})
		.from(client)
		.where(eq(client.id, clientId));
	if (!c) throw new ServiceError('Klien tidak ditemukan.');

	const [deals, projects, contacts, money, overdue, recent, previous] = await Promise.all([
		db
			.select({
				id: deal.id,
				title: deal.title,
				stage: deal.stage,
				value: deal.valueEstimate,
				createdAt: deal.createdAt,
				wonAt: deal.wonAt,
				lostAt: deal.lostAt,
				lostReason: deal.lostReason
			})
			.from(deal)
			.where(eq(deal.clientId, clientId))
			.orderBy(asc(deal.createdAt)),
		db
			.select({
				name: project.name,
				stage: project.stage,
				contractValue: project.contractValue,
				paid: paidIncome,
				startDate: project.startDate,
				finishedAt: project.finishedAt
			})
			.from(project)
			.where(eq(project.clientId, clientId))
			.orderBy(asc(project.createdAt)),
		// Names and roles only: phone numbers and emails are not sent to the model
		db
			.select({ name: contact.name, position: contact.position, isPrimary: contact.isPrimary })
			.from(contact)
			.where(eq(contact.clientId, clientId))
			.orderBy(desc(contact.isPrimary), asc(contact.name)),
		db
			.select({
				paidIn:
					sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = 'income' and ${transaction.status} = 'paid'), 0)::bigint`.mapWith(
						Number
					),
				payments: sql<number>`(count(*) filter (where ${transaction.type} = 'income' and ${transaction.status} = 'paid'))::int`
			})
			.from(transaction)
			.where(eq(transaction.clientId, clientId)),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(invoice)
			.where(sql`${invoice.clientId} = ${clientId} and ${invoice.status} = 'overdue'`),
		db
			.select({
				at: activity.occurredAt,
				type: activity.type,
				body: activity.body,
				dealId: activity.dealId,
				userName: user.name
			})
			.from(activity)
			.leftJoin(user, eq(user.id, activity.userId))
			.where(eq(activity.clientId, clientId))
			.orderBy(desc(activity.occurredAt), desc(activity.createdAt))
			.limit(HISTORY_LIMIT),
		db
			.select({
				summary: clientContext.summary,
				source: clientContext.source,
				inputHash: clientContext.inputHash
			})
			.from(clientContext)
			.where(eq(clientContext.clientId, clientId))
	]);

	const dealTitle = new Map(deals.map((d) => [d.id, d.title]));
	const history = {
		klien: { nama: c.name, industri: c.industry, kota: c.city },
		catatan_klien: cut(c.notes, 1000),
		deal: deals.map((d) => ({
			judul: d.title,
			tahap: DEAL_STAGE_META[d.stage as DealStage].label,
			nilai_rp: d.value,
			dibuat: day(d.createdAt),
			menang: day(d.wonAt),
			batal: day(d.lostAt),
			alasan_batal: cut(d.lostReason, 300)
		})),
		proyek: projects.map((p) => ({
			nama: p.name,
			tahap: PROJECT_STAGE_META[p.stage as ProjectStage].label,
			nilai_kontrak_rp: p.contractValue,
			sudah_dibayar_rp: p.paid,
			mulai: p.startDate,
			selesai: day(p.finishedAt)
		})),
		kontak: contacts.map((k) => ({ nama: k.name, jabatan: k.position, utama: k.isPrimary })),
		keuangan: {
			pemasukan_dibayar_rp: money[0]?.paidIn ?? 0,
			jumlah_pembayaran: money[0]?.payments ?? 0,
			invoice_lewat_jatuh_tempo: overdue[0]?.n ?? 0
		},
		// Oldest first, so the model reads the story in order
		riwayat: [...recent].reverse().map((a) => ({
			waktu: dateToWibLocal(a.at).replace('T', ' '),
			jenis: a.type,
			deal: a.dealId ? (dealTitle.get(a.dealId) ?? null) : null,
			oleh: a.userName,
			isi: cut(a.body, 400)
		}))
	};
	return {
		client: c,
		history,
		hash: createHash('sha256').update(JSON.stringify(history)).digest('hex'),
		previous: previous[0] ?? null
	};
}

const contextAnswer = z.object({ summary: z.string().trim().min(10) });

export type RefreshResult =
	| { status: 'skipped' | 'empty'; clientId: string }
	| {
			status: 'updated';
			clientId: string;
			model: string;
			usage: { input: number; output: number } | null;
	  };

/**
 * Rewrite the summary from the previous one plus the history. Skipped when the history has not
 * changed since the last AI summary (unless forced), or when there is nothing to summarise yet.
 */
export async function refreshClientContext(
	db: DbOrTx,
	clientId: string,
	opts: { complete: AiComplete; force?: boolean }
): Promise<RefreshResult> {
	const { client: c, history, hash, previous } = await buildHistory(db, clientId);
	if (c.archivedAt) throw new ServiceError('Klien ini sudah diarsipkan.');
	if (!history.deal.length && !history.riwayat.length && !history.catatan_klien)
		return { status: 'empty', clientId };
	if (!opts.force && previous?.inputHash === hash) return { status: 'skipped', clientId };

	const answer = await opts.complete({
		system: CONTEXT_SYSTEM,
		user: contextUserMessage({
			ringkasan_sebelumnya: previous?.summary ?? null,
			sumber_sebelumnya: previous?.source ?? null,
			...history
		}),
		schema: CONTEXT_SCHEMA,
		schemaName: 'ringkasan_konteks',
		allowText: true
	});
	// Some models answer with the bare text instead of { summary }
	const parsed = contextAnswer.safeParse(
		typeof answer.json === 'string' ? { summary: answer.json } : answer.json
	);
	if (!parsed.success)
		throw new Error(`AI answer does not match the schema: ${parsed.error.message}`);

	const values = {
		summary: parsed.data.summary.slice(0, CONTEXT_MAX_LENGTH),
		source: 'ai',
		inputHash: hash,
		model: answer.model,
		updatedBy: null,
		updatedAt: new Date()
	};
	await db
		.insert(clientContext)
		.values({ clientId, ...values })
		.onConflictDoUpdate({ target: clientContext.clientId, set: values });
	return { status: 'updated', clientId, model: answer.model, usage: answer.usage };
}

/** The team's edit. The AI's next update starts from this text and keeps its facts. */
export async function saveClientContext(
	db: DbOrTx,
	clientId: string,
	summary: string,
	userId: string
) {
	const text = summary.trim();
	if (text.length < 3) throw new ServiceError('Tulis ringkasannya (min. 3 karakter).', 'summary');
	if (text.length > CONTEXT_MAX_LENGTH)
		throw new ServiceError(`Maksimal ${CONTEXT_MAX_LENGTH} karakter.`, 'summary');
	const [c] = await db
		.select({ archivedAt: client.archivedAt })
		.from(client)
		.where(eq(client.id, clientId));
	if (!c) throw new ServiceError('Klien tidak ditemukan.');
	if (c.archivedAt) throw new ServiceError('Klien ini sudah diarsipkan.');
	const values = { summary: text, source: 'team', updatedBy: userId, updatedAt: new Date() };
	await db
		.insert(clientContext)
		.values({ clientId, ...values })
		.onConflictDoUpdate({ target: clientContext.clientId, set: values });
}
