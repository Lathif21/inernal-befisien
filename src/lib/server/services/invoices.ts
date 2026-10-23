// Invoices (P2-04): numbering and storage. Relative imports only: Trigger.dev jobs (P2-09) use this.
// The editor, status flow and payments come in P2-05 / P2-07.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { formatInvoiceNumber, invoiceTotals } from '../../invoice';
import { rupiah } from '../../format';
import type { InvoiceInput } from '../../schemas/invoice';
import type { DbOrTx, Tx } from '../db/client';
import { client, invoice, invoiceCounter, invoiceItem, project } from '../db/schema/index';
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
