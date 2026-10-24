// Invoice status from its payments (P2-07). Relative imports only: shared with Trigger.dev.
// Called inside the caller's transaction whenever a transaction linked to an invoice is created,
// edited or deleted, so Keuangan edits keep the invoice right too.
import { eq, sql } from 'drizzle-orm';
import { dayKeyWib, rupiah } from '../../format';
import { paymentStatus } from '../../invoice';
import type { DbOrTx, Tx } from '../db/client';
import { invoice, transaction } from '../db/schema/index';
import { logActivity } from './activity';
import { ServiceError } from './errors';

/** Paid income linked to an invoice, and whether every linked row is income from its client */
async function paymentsOf(db: DbOrTx, invoiceId: string, clientId: string) {
	const [row] = await db
		.select({
			paid: sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.status} = 'paid'), 0)::bigint`.mapWith(
				Number
			),
			fits: sql<boolean>`coalesce(bool_and(${transaction.type} = 'income' and ${transaction.clientId} = ${clientId}), true)`
		})
		.from(transaction)
		.where(eq(transaction.invoiceId, invoiceId));
	return row;
}

/**
 * Re-derive the status of an invoice from its paid payments. Refuses payments above the invoice
 * total or ones that are not income from the invoice's client (the caller's transaction rolls back).
 * Draft and void invoices keep their status. Returns the status after the sync.
 */
export async function syncInvoiceStatus(tx: Tx, invoiceId: string, userId: string) {
	const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).for('update');
	if (!inv) throw new ServiceError('Invoice tidak ditemukan.');
	const { paid, fits } = await paymentsOf(tx, invoiceId, inv.clientId);
	if (!fits)
		throw new ServiceError(
			`Transaksi ini pembayaran ${inv.number}: harus pemasukan dari klien invoice itu.`,
			'clientId'
		);
	if (paid > inv.total)
		throw new ServiceError(
			`Pembayaran ${inv.number} jadi ${rupiah(paid)}, melebihi nilai invoice ${rupiah(inv.total)}.`,
			'amount'
		);
	if (inv.status === 'draft' || inv.status === 'void') return inv.status;

	const status = paymentStatus({ ...inv, paid, today: dayKeyWib() });
	if (status === inv.status) return status;
	await tx.update(invoice).set({ status, updatedAt: new Date() }).where(eq(invoice.id, invoiceId));
	if (status === 'paid' || inv.status === 'paid')
		await logActivity(tx, {
			clientId: inv.clientId,
			projectId: inv.projectId,
			type: 'system',
			body:
				status === 'paid'
					? `Invoice ${inv.number} lunas (${rupiah(paid)} diterima)`
					: `Invoice ${inv.number} tidak lagi lunas`,
			meta: { invoiceId: inv.id },
			userId
		});
	return status;
}

/** Paid so far and what is still expected in cash (total − PPh 23 − paid, never below 0) */
export async function invoiceBalance(
	db: DbOrTx,
	inv: { id: string; clientId: string; total: number; pph23Amount: number }
) {
	const { paid } = await paymentsOf(db, inv.id, inv.clientId);
	const expected = inv.total - inv.pph23Amount;
	return { paid, expected, remaining: Math.max(0, expected - paid) };
}
