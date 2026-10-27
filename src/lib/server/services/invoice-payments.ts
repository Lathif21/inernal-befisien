// Payments against an invoice (P2-07): "Catat Pembayaran" creates a paid income transaction linked
// by invoice_id, or links an income row already in Keuangan (so it is not recorded twice), then the
// invoice status follows (sebagian / lunas). Relative imports only.
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { PaymentInput } from '../../schemas/invoice';
import type { TransactionInput } from '../../schemas/transaction';
import type { DbOrTx } from '../db/client';
import { category, invoice, project, transaction } from '../db/schema/index';
import { ServiceError } from './errors';
import { assertPayable, invoiceBalance, syncInvoiceStatus } from './invoice-status';
import { deleteTransaction, insertTransaction, updateTransactionTx } from './transactions';

/** A stored row as form input, so edits go through the same checks as Keuangan */
const inputOf = (row: typeof transaction.$inferSelect): TransactionInput => ({
	id: row.id,
	type: row.type,
	status: row.status === 'cancelled' ? 'planned' : row.status,
	date: row.date,
	amount: row.amount,
	clientId: row.clientId ?? '',
	projectId: row.projectId ?? '',
	invoiceId: row.invoiceId ?? '',
	categoryId: row.categoryId ?? '',
	method: row.method ?? '',
	description: row.description ?? '',
	reference: row.reference ?? ''
});

export async function recordPayment(
	db: DbOrTx,
	invoiceId: string,
	input: PaymentInput,
	userId: string
) {
	return db.transaction(async (tx) => {
		const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).for('update');
		if (!inv) throw new ServiceError('Invoice tidak ditemukan.');
		assertPayable(inv.status);

		const fields = {
			type: 'income' as const,
			status: 'paid' as const,
			date: input.date,
			amount: input.amount,
			clientId: inv.clientId,
			invoiceId: inv.id,
			categoryId: input.categoryId,
			method: input.method,
			reference: input.reference
		};
		let row;
		if (input.transactionId) {
			// an income row already in Keuangan (paid or planned) becomes this payment
			const [existing] = await tx
				.select()
				.from(transaction)
				.where(eq(transaction.id, input.transactionId))
				.for('update');
			if (
				!existing ||
				existing.type !== 'income' ||
				existing.clientId !== inv.clientId ||
				existing.status === 'cancelled'
			)
				throw new ServiceError('Transaksi tidak ditemukan untuk klien ini.', 'transactionId');
			if (existing.invoiceId)
				throw new ServiceError('Transaksi ini sudah terhubung ke invoice lain.', 'transactionId');
			row = await updateTransactionTx(
				tx,
				{
					...inputOf(existing),
					...fields,
					projectId: existing.projectId ?? inv.projectId ?? '',
					description: input.description || existing.description || `Pembayaran ${inv.number}`
				},
				userId
			);
		} else {
			row = await insertTransaction(
				tx,
				{
					...fields,
					id: '',
					projectId: inv.projectId ?? '',
					description: input.description || `Pembayaran ${inv.number}`
				},
				userId
			);
		}
		const status = await syncInvoiceStatus(tx, inv.id, userId);
		return { transaction: row, status, number: inv.number, linked: !!input.transactionId };
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

/** "Lepas dari invoice": the row stays in Keuangan without the link; the invoice status follows */
export async function unlinkInvoicePayment(
	db: DbOrTx,
	invoiceId: string,
	transactionId: string,
	userId: string
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(transaction)
			.where(eq(transaction.id, transactionId))
			.for('update');
		if (row?.invoiceId !== invoiceId) throw new ServiceError('Pembayaran tidak ditemukan.');
		return updateTransactionTx(tx, { ...inputOf(row), invoiceId: '' }, userId);
	});
}

/**
 * Income rows in Keuangan that could be this invoice's payment: the invoice's client, not linked to
 * any invoice, paid or planned, and (when the invoice has a project) that project or none.
 */
export function linkableTransactions(
	db: DbOrTx,
	inv: { clientId: string; projectId: string | null }
) {
	return db
		.select({
			id: transaction.id,
			status: transaction.status,
			date: transaction.date,
			amount: transaction.amount,
			categoryId: transaction.categoryId,
			categoryName: category.name,
			method: transaction.method,
			reference: transaction.reference,
			description: transaction.description,
			projectName: project.name
		})
		.from(transaction)
		.leftJoin(category, eq(category.id, transaction.categoryId))
		.leftJoin(project, eq(project.id, transaction.projectId))
		.where(
			and(
				eq(transaction.clientId, inv.clientId),
				eq(transaction.type, 'income'),
				inArray(transaction.status, ['paid', 'planned']),
				isNull(transaction.invoiceId),
				inv.projectId
					? or(eq(transaction.projectId, inv.projectId), isNull(transaction.projectId))
					: undefined
			)
		)
		.orderBy(desc(transaction.date), desc(transaction.createdAt))
		.limit(50);
}

export type LinkableTransaction = Awaited<ReturnType<typeof linkableTransactions>>[number];

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
