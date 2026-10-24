// Payments against an invoice (P2-07): "Catat Pembayaran" creates a paid income transaction linked
// by invoice_id, then the invoice status follows (sebagian / lunas). Relative imports only.
import { asc, eq } from 'drizzle-orm';
import { PAYABLE_INVOICE_STATUSES } from '../../invoice';
import type { PaymentInput } from '../../schemas/invoice';
import type { DbOrTx } from '../db/client';
import { category, invoice, transaction } from '../db/schema/index';
import { ServiceError } from './errors';
import { invoiceBalance, syncInvoiceStatus } from './invoice-status';
import { deleteTransaction, insertTransaction } from './transactions';

const NOT_PAYABLE: Record<string, string> = {
	draft: 'Tandai invoice terkirim dulu sebelum mencatat pembayaran.',
	paid: 'Invoice ini sudah lunas.',
	void: 'Invoice ini dibatalkan.'
};

export async function recordPayment(
	db: DbOrTx,
	invoiceId: string,
	input: PaymentInput,
	userId: string
) {
	return db.transaction(async (tx) => {
		const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).for('update');
		if (!inv) throw new ServiceError('Invoice tidak ditemukan.');
		if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status))
			throw new ServiceError(NOT_PAYABLE[inv.status] ?? 'Invoice ini tidak menerima pembayaran.');

		const row = await insertTransaction(
			tx,
			{
				id: '',
				type: 'income',
				status: 'paid',
				date: input.date,
				amount: input.amount,
				clientId: inv.clientId,
				projectId: inv.projectId ?? '',
				categoryId: input.categoryId,
				method: input.method,
				description: input.description || `Pembayaran ${inv.number}`,
				reference: input.reference
			},
			userId,
			inv.id
		);
		const status = await syncInvoiceStatus(tx, inv.id, userId);
		return { transaction: row, status, number: inv.number };
	});
}

/** Delete a payment from the invoice page; the transaction must belong to that invoice */
export async function deleteInvoicePayment(
	db: DbOrTx,
	invoiceId: string,
	transactionId: string,
	userId: string
) {
	const [row] = await db
		.select({ invoiceId: transaction.invoiceId })
		.from(transaction)
		.where(eq(transaction.id, transactionId));
	if (row?.invoiceId !== invoiceId) throw new ServiceError('Pembayaran tidak ditemukan.');
	return deleteTransaction(db, transactionId, userId);
}

/** Linked transactions, oldest first, plus the balance for the payment box */
export async function getInvoicePayments(
	db: DbOrTx,
	inv: { id: string; clientId: string; total: number; pph23Amount: number }
) {
	const [rows, balance] = await Promise.all([
		db
			.select({
				id: transaction.id,
				date: transaction.date,
				amount: transaction.amount,
				status: transaction.status,
				method: transaction.method,
				reference: transaction.reference,
				description: transaction.description,
				categoryName: category.name
			})
			.from(transaction)
			.leftJoin(category, eq(category.id, transaction.categoryId))
			.where(eq(transaction.invoiceId, inv.id))
			.orderBy(asc(transaction.date), asc(transaction.createdAt)),
		invoiceBalance(db, inv)
	]);
	return { rows, ...balance };
}

export type InvoicePayments = Awaited<ReturnType<typeof getInvoicePayments>>;
