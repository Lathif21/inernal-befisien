// Invoices (P2-04): numbering and storage. Relative imports only: Trigger.dev jobs (P2-09) use this.
// Partial / paid come from recorded payments (P2-07).
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { InvoiceStatus } from '../../constants';
import { formatInvoiceNumber, invoiceTotals } from '../../invoice';
import { rupiah } from '../../format';
import type { InvoiceInput } from '../../schemas/invoice';
import type { DbOrTx, Tx } from '../db/client';
import {
	client,
	invoice,
	invoiceCounter,
	invoiceItem,
	project,
	transaction
} from '../db/schema/index';
import { logActivity } from './activity';
import { ServiceError } from './errors';

/**
 * Next number for the issue month, e.g. INV/BEF/2026/10/007. One atomic upsert on the month's
 * counter row: concurrent transactions queue on that row, so numbers never repeat. Must run inside
 * the transaction that inserts the invoice, so a failed insert gives the number back.
 */
export async function nextInvoiceNumber(tx: Tx, issueDate: string) {
	const period = issueDate.slice(0, 7);
	const [row] = await tx
		.insert(invoiceCounter)
		.values({ period, last: 1 })
		.onConflictDoUpdate({
			target: invoiceCounter.period,
			set: { last: sql`${invoiceCounter.last} + 1` }
		})
		.returning({ last: invoiceCounter.last });
	return formatInvoiceNumber(issueDate, row.last);
}

async function checkRefs(tx: Tx, input: InvoiceInput) {
	const [c] = await tx
		.select({ id: client.id })
		.from(client)
		.where(and(eq(client.id, input.clientId), isNull(client.archivedAt)));
	if (!c) throw new ServiceError('Klien tidak ditemukan atau sudah diarsipkan.', 'clientId');
	if (input.projectId) {
		const [p] = await tx
			.select({ clientId: project.clientId })
			.from(project)
			.where(eq(project.id, input.projectId));
		if (!p || p.clientId !== input.clientId)
			throw new ServiceError('Proyek ini bukan milik klien tersebut.', 'projectId');
	}
}

/** New draft invoice with its items; totals computed here, number from the issue month */
export async function createInvoice(db: DbOrTx, input: InvoiceInput, userId: string) {
	return db.transaction(async (tx) => {
		await checkRefs(tx, input);
		const totals = invoiceTotals(input.items, input);
		const number = await nextInvoiceNumber(tx, input.issueDate);
		const [row] = await tx
			.insert(invoice)
			.values({
				number,
				clientId: input.clientId,
				projectId: input.projectId || null,
				issueDate: input.issueDate,
				dueDate: input.dueDate,
				ppnRate: input.ppnRate,
				pph23Rate: input.pph23Rate,
				subtotal: totals.subtotal,
				ppnAmount: totals.ppnAmount,
				pph23Amount: totals.pph23Amount,
				total: totals.total,
				notes: input.notes || null,
				createdBy: userId
			})
			.returning();
		await tx.insert(invoiceItem).values(
			input.items.map((it, i) => ({
				invoiceId: row.id,
				description: it.description,
				qty: it.qty,
				unitPrice: it.unitPrice,
				amount: totals.lines[i],
				sort: i
			}))
		);
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.projectId,
			type: 'system',
			body: `Invoice ${row.number} dibuat (${rupiah(row.total)})`,
			meta: { invoiceId: row.id },
			userId
		});
		return row;
	});
}

/** One invoice with its items and what the printed invoice needs from the client (NPWP) */
export async function getInvoice(db: DbOrTx, id: string) {
	const [row] = await db
		.select({
			invoice,
			clientName: client.name,
			clientNpwp: client.npwp,
			clientAddress: client.address,
			clientCity: client.city,
			projectName: project.name
		})
		.from(invoice)
		.innerJoin(client, eq(client.id, invoice.clientId))
		.leftJoin(project, eq(project.id, invoice.projectId))
		.where(eq(invoice.id, id));
	if (!row) return null;
	const items = await db
		.select()
		.from(invoiceItem)
		.where(eq(invoiceItem.invoiceId, id))
		.orderBy(asc(invoiceItem.sort));
	return {
		...row.invoice,
		client: {
			name: row.clientName,
			npwp: row.clientNpwp,
			address: row.clientAddress,
			city: row.clientCity
		},
		projectName: row.projectName,
		items
	};
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

// ---------- edit, status, list (P2-05) ----------

async function lockInvoice(tx: Tx, id: string) {
	const [row] = await tx.select().from(invoice).where(eq(invoice.id, id)).for('update');
	if (!row) throw new ServiceError('Invoice tidak ditemukan.');
	return row;
}

/**
 * Edit a draft. Items are replaced and totals recomputed. The issue month cannot change: the
 * number belongs to it (void and create a new invoice instead).
 */
export async function updateInvoice(db: DbOrTx, input: InvoiceInput, userId: string) {
	return db.transaction(async (tx) => {
		const current = await lockInvoice(tx, input.id);
		if (current.status !== 'draft') throw new ServiceError('Hanya invoice draf yang bisa diubah.');
		if (current.clientId !== input.clientId)
			throw new ServiceError('Klien invoice tidak bisa diganti. Buat invoice baru.', 'clientId');
		if (current.issueDate.slice(0, 7) !== input.issueDate.slice(0, 7))
			throw new ServiceError(
				`Tanggal invoice harus tetap di bulan ${current.issueDate.slice(5, 7)}/${current.issueDate.slice(0, 4)} karena nomornya ${current.number}.`,
				'issueDate'
			);
		await checkRefs(tx, input);
		const totals = invoiceTotals(input.items, input);
		const [row] = await tx
			.update(invoice)
			.set({
				projectId: input.projectId || null,
				issueDate: input.issueDate,
				dueDate: input.dueDate,
				ppnRate: input.ppnRate,
				pph23Rate: input.pph23Rate,
				subtotal: totals.subtotal,
				ppnAmount: totals.ppnAmount,
				pph23Amount: totals.pph23Amount,
				total: totals.total,
				notes: input.notes || null
			})
			.where(eq(invoice.id, current.id))
			.returning();
		await tx.delete(invoiceItem).where(eq(invoiceItem.invoiceId, current.id));
		await tx.insert(invoiceItem).values(
			input.items.map((it, i) => ({
				invoiceId: current.id,
				description: it.description,
				qty: it.qty,
				unitPrice: it.unitPrice,
				amount: totals.lines[i],
				sort: i
			}))
		);
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.projectId,
			type: 'system',
			body: `Invoice ${row.number} diubah (${rupiah(row.total)})`,
			meta: { invoiceId: row.id },
			userId
		});
		return row;
	});
}

/** "Tandai Terkirim": the draft is final from here on */
export async function markInvoiceSent(db: DbOrTx, id: string, userId: string, now = new Date()) {
	return db.transaction(async (tx) => {
		const current = await lockInvoice(tx, id);
		if (current.status !== 'draft') throw new ServiceError('Invoice ini sudah dikirim.');
		const [row] = await tx
			.update(invoice)
			.set({ status: 'sent', sentAt: now })
			.where(eq(invoice.id, id))
			.returning();
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.projectId,
			type: 'system',
			body: `Invoice ${row.number} dikirim (${rupiah(row.total)}, jatuh tempo ${row.dueDate})`,
			meta: { invoiceId: row.id },
			userId
		});
		return row;
	});
}

/** "Batalkan invoice": kept with its number for the record; refused once payments are recorded */
export async function voidInvoice(db: DbOrTx, id: string, userId: string) {
	return db.transaction(async (tx) => {
		const current = await lockInvoice(tx, id);
		if (current.status === 'void') throw new ServiceError('Invoice ini sudah dibatalkan.');
		const [{ paid }] = await tx
			.select({ paid: sql<number>`count(*)::int` })
			.from(transaction)
			.where(eq(transaction.invoiceId, id));
		if (paid > 0)
			throw new ServiceError('Invoice ini sudah punya pembayaran, jadi tidak bisa dibatalkan.');
		const [row] = await tx
			.update(invoice)
			.set({ status: 'void' })
			.where(eq(invoice.id, id))
			.returning();
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.projectId,
			type: 'system',
			body: `Invoice ${row.number} dibatalkan`,
			meta: { invoiceId: row.id },
			userId
		});
		return row;
	});
}

export const INVOICE_PAGE_SIZE = 25;

export type InvoiceFilters = {
	q?: string;
	status?: InvoiceStatus;
	clientId?: string;
	page?: number;
};

/** The list: newest number first, with how many invoices each status has (for the chips) */
export async function listInvoices(db: DbOrTx, f: InvoiceFilters = {}) {
	const where: SQL[] = [];
	if (f.clientId) where.push(eq(invoice.clientId, f.clientId));
	const q = f.q?.trim();
	if (q) {
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(or(ilike(invoice.number, like), ilike(client.name, like))!);
	}
	const base = and(...where);
	const [counts, [{ total }]] = await Promise.all([
		db
			.select({ status: invoice.status, n: sql<number>`count(*)::int` })
			.from(invoice)
			.innerJoin(client, eq(client.id, invoice.clientId))
			.where(base)
			.groupBy(invoice.status),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(invoice)
			.innerJoin(client, eq(client.id, invoice.clientId))
			.where(and(base, f.status ? eq(invoice.status, f.status) : undefined))
	]);
	const page = Math.max(1, f.page ?? 1);
	const rows = await db
		.select({
			id: invoice.id,
			number: invoice.number,
			status: invoice.status,
			issueDate: invoice.issueDate,
			dueDate: invoice.dueDate,
			total: invoice.total,
			pph23Amount: invoice.pph23Amount,
			// paid payments (P2-07); columns qualified: this is a correlated subquery
			paid: sql<number>`(select coalesce(sum("transaction"."amount"), 0) from "transaction" where "transaction"."invoice_id" = "invoice"."id" and "transaction"."status" = 'paid')::bigint`.mapWith(
				Number
			),
			// "Keterangan" column: the first item and how many there are
			firstItem: sql<
				string | null
			>`(select "invoice_item"."description" from "invoice_item" where "invoice_item"."invoice_id" = "invoice"."id" order by "invoice_item"."sort", "invoice_item"."id" limit 1)`,
			itemCount: sql<number>`(select count(*) from "invoice_item" where "invoice_item"."invoice_id" = "invoice"."id")::int`,
			clientId: invoice.clientId,
			clientName: client.name,
			projectName: project.name
		})
		.from(invoice)
		.innerJoin(client, eq(client.id, invoice.clientId))
		.leftJoin(project, eq(project.id, invoice.projectId))
		.where(and(base, f.status ? eq(invoice.status, f.status) : undefined))
		.orderBy(desc(invoice.issueDate), desc(invoice.number))
		.limit(INVOICE_PAGE_SIZE)
		.offset((page - 1) * INVOICE_PAGE_SIZE);
	return {
		rows,
		total,
		page,
		pageSize: INVOICE_PAGE_SIZE,
		counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<
			Record<InvoiceStatus, number>
		>
	};
}

/** Clients that can be invoiced, with their projects (editor selects) */
export async function listInvoiceTargets(db: DbOrTx) {
	const [clients, projects] = await Promise.all([
		db
			.select({ id: client.id, name: client.name, npwp: client.npwp })
			.from(client)
			.where(isNull(client.archivedAt))
			.orderBy(asc(client.name)),
		db
			.select({
				id: project.id,
				name: project.name,
				clientId: project.clientId,
				contractValue: project.contractValue
			})
			.from(project)
			.orderBy(asc(project.name))
	]);
	return { clients, projects };
}
