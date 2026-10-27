// Transactions (money in / out) and the totals built from them. Relative imports only: shared with
// Trigger.dev. Rule 5 (docs/02-DATA-MODEL.md): every create / edit / delete logs a `transaction`
// activity, and totals are always computed by queries, never stored.
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	ilike,
	lte,
	notInArray,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { TXN_TYPE_LABELS, type PaymentMethod, type TxnStatus, type TxnType } from '../../constants';
import { rupiah } from '../../format';
import type { TransactionInput } from '../../schemas/transaction';
import type { DbOrTx, Tx } from '../db/client';
import { category, client, invoice, project, transaction } from '../db/schema/index';
import { logActivity } from './activity';
import { ServiceError } from './errors';
import { assertPayable, syncInvoiceStatus } from './invoice-status';

export const TXN_PAGE_SIZE = 25;

export type TxnFilters = {
	clientId?: string;
	projectId?: string;
	/** Description, category, client or project name */
	q?: string;
	type?: TxnType;
	status?: TxnStatus;
	categoryId?: string;
	/** Calendar days, inclusive (WIB) */
	from?: string;
	to?: string;
};

function whereOf(f: TxnFilters) {
	const where: SQL[] = [];
	if (f.clientId) where.push(eq(transaction.clientId, f.clientId));
	if (f.projectId) where.push(eq(transaction.projectId, f.projectId));
	if (f.type) where.push(eq(transaction.type, f.type));
	if (f.status) where.push(eq(transaction.status, f.status));
	if (f.categoryId) where.push(eq(transaction.categoryId, f.categoryId));
	if (f.from) where.push(gte(transaction.date, f.from));
	if (f.to) where.push(lte(transaction.date, f.to));
	const q = f.q?.trim();
	if (q) {
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(
			or(
				ilike(transaction.description, like),
				ilike(category.name, like),
				ilike(client.name, like),
				ilike(project.name, like)
			)!
		);
	}
	return and(...where);
}

const paidSum = (type: TxnType) =>
	sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = ${type} and ${transaction.status} = 'paid'), 0)::bigint`.mapWith(
		Number
	);
const plannedSum = (type: TxnType) =>
	sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = ${type} and ${transaction.status} = 'planned'), 0)::bigint`.mapWith(
		Number
	);

/**
 * One page of transactions (newest first) plus how many match and their paid totals, so the
 * table can say "Menampilkan x dari y transaksi" and sum up the filtered view.
 */
export async function listTransactions(
	db: DbOrTx,
	filters: TxnFilters = {},
	{ page = 1, pageSize = TXN_PAGE_SIZE }: { page?: number; pageSize?: number } = {}
) {
	const where = whereOf(filters);
	const [[summary], all] = await Promise.all([
		db
			.select({ total: count(), income: paidSum('income'), expense: paidSum('expense') })
			.from(transaction)
			.leftJoin(client, eq(client.id, transaction.clientId))
			.leftJoin(project, eq(project.id, transaction.projectId))
			.leftJoin(category, eq(category.id, transaction.categoryId))
			.where(where),
		// "dari y": everything in scope before search / type / period
		db
			.select({ n: count() })
			.from(transaction)
			.where(
				and(
					filters.clientId ? eq(transaction.clientId, filters.clientId) : undefined,
					filters.projectId ? eq(transaction.projectId, filters.projectId) : undefined
				)
			)
	]);
	const pages = Math.max(1, Math.ceil(summary.total / pageSize));
	const current = Math.min(Math.max(1, page), pages);

	const rows = await db
		.select({
			id: transaction.id,
			type: transaction.type,
			status: transaction.status,
			date: transaction.date,
			amount: transaction.amount,
			description: transaction.description,
			method: transaction.method,
			reference: transaction.reference,
			categoryId: transaction.categoryId,
			categoryName: category.name,
			clientId: transaction.clientId,
			clientName: client.name,
			projectId: transaction.projectId,
			projectName: project.name,
			invoiceId: transaction.invoiceId,
			invoiceNumber: invoice.number,
			isOverhead: sql<boolean>`coalesce(${category.isOverhead}, false)`
		})
		.from(transaction)
		.leftJoin(client, eq(client.id, transaction.clientId))
		.leftJoin(project, eq(project.id, transaction.projectId))
		.leftJoin(category, eq(category.id, transaction.categoryId))
		.leftJoin(invoice, eq(invoice.id, transaction.invoiceId))
		.where(where)
		.orderBy(desc(transaction.date), desc(transaction.createdAt), desc(transaction.id))
		.limit(pageSize)
		.offset((current - 1) * pageSize);

	return {
		rows,
		total: summary.total,
		all: all[0].n,
		paidIncome: summary.income,
		paidExpense: summary.expense,
		page: current,
		pageSize
	};
}

export type TransactionRow = Awaited<ReturnType<typeof listTransactions>>['rows'][number];

/**
 * Income, expense and profit (paid only) plus planned amounts, for a client and / or a date range.
 * Profit = paid income − paid expense (docs/02-DATA-MODEL.md "Client profit").
 */
export async function financeTotals(
	db: DbOrTx,
	f: { clientId?: string; projectId?: string; from?: string; to?: string } = {}
) {
	const [row] = await db
		.select({
			income: paidSum('income'),
			expense: paidSum('expense'),
			plannedIncome: plannedSum('income'),
			plannedExpense: plannedSum('expense'),
			plannedCount: sql<number>`(count(*) filter (where ${transaction.status} = 'planned'))::int`
		})
		.from(transaction)
		.where(whereOf(f));
	const profit = row.income - row.expense;
	return {
		...row,
		profit,
		/** Profit as a share of paid income; null without income */
		margin: row.income > 0 ? Math.round((profit / row.income) * 100) : null
	};
}

export type FinanceTotals = Awaited<ReturnType<typeof financeTotals>>;

/** Categories for the form and the filter, grouped by type in their seed order */
export function listCategories(db: DbOrTx) {
	return db
		.select({
			id: category.id,
			type: category.type,
			name: category.name,
			isOverhead: category.isOverhead
		})
		.from(category)
		.orderBy(asc(category.type), asc(category.sort), asc(category.name));
}

/** Clients and their projects for the form (archived clients cannot get new transactions) */
export async function listTxnTargets(db: DbOrTx) {
	const [clients, projects] = await Promise.all([
		db
			.select({
				id: client.id,
				name: client.name,
				archived: sql<boolean>`${client.archivedAt} is not null`
			})
			.from(client)
			.orderBy(asc(client.name)),
		db
			.select({ id: project.id, name: project.name, clientId: project.clientId })
			.from(project)
			.orderBy(asc(project.name))
	]);
	return { clients, projects, invoices: await listTxnInvoices(db) };
}

/**
 * Invoices an income row can pay (form "Invoice" select), newest first, with what is paid so far.
 * Draft and void invoices never take payments; paid ones are listed for rows already linked.
 */
export function listTxnInvoices(db: DbOrTx, clientId?: string) {
	return db
		.select({
			id: invoice.id,
			number: invoice.number,
			clientId: invoice.clientId,
			projectId: invoice.projectId,
			status: invoice.status,
			total: invoice.total,
			pph23Amount: invoice.pph23Amount,
			// columns qualified: this is a correlated subquery
			paid: sql<number>`(select coalesce(sum("transaction"."amount"), 0) from "transaction" where "transaction"."invoice_id" = "invoice"."id" and "transaction"."status" = 'paid')::bigint`.mapWith(
				Number
			)
		})
		.from(invoice)
		.where(
			and(
				notInArray(invoice.status, ['draft', 'void']),
				clientId ? eq(invoice.clientId, clientId) : undefined
			)
		)
		.orderBy(desc(invoice.issueDate), desc(invoice.number));
}

export type TxnInvoice = Awaited<ReturnType<typeof listTxnInvoices>>[number];

// ---------- create / edit / delete ----------

/**
 * Category, client and project must exist and fit together. An overhead category (P2-08) means no
 * client and no project; every other transaction needs a client. Returns whether it is overhead.
 */
async function checkRefs(tx: Tx, input: TransactionInput, isNew: boolean) {
	const [cat] = await tx
		.select({ type: category.type, isOverhead: category.isOverhead })
		.from(category)
		.where(eq(category.id, input.categoryId));
	if (!cat) throw new ServiceError('Kategori tidak ditemukan.', 'categoryId');
	if (cat.type !== input.type)
		throw new ServiceError(
			`Kategori ini untuk ${TXN_TYPE_LABELS[cat.type].long.toLowerCase()}.`,
			'categoryId'
		);
	if (cat.isOverhead) return true;

	if (!input.clientId) throw new ServiceError('Pilih klien.', 'clientId');
	const [c] = await tx
		.select({ id: client.id, archivedAt: client.archivedAt })
		.from(client)
		.where(eq(client.id, input.clientId));
	if (!c) throw new ServiceError('Klien tidak ditemukan.', 'clientId');
	if (isNew && c.archivedAt) throw new ServiceError('Klien sudah diarsipkan.', 'clientId');

	if (input.projectId) {
		const [p] = await tx
			.select({ clientId: project.clientId })
			.from(project)
			.where(eq(project.id, input.projectId));
		if (!p) throw new ServiceError('Proyek tidak ditemukan.', 'projectId');
		if (p.clientId !== input.clientId)
			throw new ServiceError('Proyek ini milik klien lain.', 'projectId');
	}
	return false;
}

const values = (input: TransactionInput, overhead: boolean) => ({
	type: input.type,
	status: input.status,
	date: input.date,
	amount: input.amount!,
	clientId: overhead ? null : input.clientId,
	projectId: overhead ? null : input.projectId || null,
	categoryId: input.categoryId,
	invoiceId: overhead ? null : input.invoiceId || null,
	method: (input.method || null) as PaymentMethod | null,
	description: input.description || null,
	reference: input.reference || null
});

/** "Pemasukan Rp 16.000.000 (direncanakan) dicatat: DP 50% website" */
const summary = (
	verb: string,
	t: {
		type: TxnType;
		status: TxnStatus;
		amount: number;
		description: string | null;
	}
) =>
	`${TXN_TYPE_LABELS[t.type].long} ${rupiah(t.amount)}${t.status === 'planned' ? ' (direncanakan)' : ''} ${verb}${t.description ? `: ${t.description}` : ''}`;

/** Rule 5: on the client's timeline. Overhead has no client, so it has no timeline entry. */
async function logTransaction(
	tx: Tx,
	row: typeof transaction.$inferSelect,
	verb: string,
	action: string,
	userId: string
) {
	if (!row.clientId) return;
	await logActivity(tx, {
		clientId: row.clientId,
		projectId: row.projectId,
		type: 'transaction',
		body: summary(verb, row),
		meta: { transactionId: row.id, action },
		userId
	});
}

/**
 * The invoice an income row pays: the same client, and payable unless the row was already linked
 * to it (`linked`). Null without one. The amounts are checked afterwards by syncInvoiceStatus.
 */
async function checkInvoice(
	tx: Tx,
	input: TransactionInput,
	overhead: boolean,
	linked: string | null
) {
	if (!input.invoiceId) return null;
	if (overhead || input.type !== 'income')
		throw new ServiceError(
			'Hanya pemasukan dari klien yang bisa dihubungkan ke invoice.',
			'invoiceId'
		);
	const [inv] = await tx
		.select({
			id: invoice.id,
			number: invoice.number,
			clientId: invoice.clientId,
			status: invoice.status
		})
		.from(invoice)
		.where(eq(invoice.id, input.invoiceId));
	if (!inv) throw new ServiceError('Invoice tidak ditemukan.', 'invoiceId');
	if (inv.clientId !== input.clientId)
		throw new ServiceError(`${inv.number} milik klien lain.`, 'invoiceId');
	if (inv.id !== linked) assertPayable(inv.status, 'invoiceId');
	return inv;
}

/**
 * Insert + activity inside the caller's transaction. With `input.invoiceId` it is a payment
 * (P2-07): the caller runs syncInvoiceStatus afterwards in the same transaction.
 */
export async function insertTransaction(tx: Tx, input: TransactionInput, userId: string) {
	const overhead = await checkRefs(tx, input, true);
	await checkInvoice(tx, input, overhead, null);
	const [row] = await tx
		.insert(transaction)
		.values({ ...values(input, overhead), createdBy: userId })
		.returning();
	await logTransaction(tx, row, 'dicatat', 'created', userId);
	return row;
}

export async function createTransaction(db: DbOrTx, input: TransactionInput, userId: string) {
	return db.transaction(async (tx) => {
		const row = await insertTransaction(tx, input, userId);
		if (row.invoiceId) await syncInvoiceStatus(tx, row.invoiceId, userId);
		return row;
	});
}

/**
 * Edit inside the caller's transaction. `input.invoiceId` links the row to an invoice, moves it to
 * another one, or ('') unlinks it; every invoice it left or joined gets its status re-derived.
 */
export async function updateTransactionTx(tx: Tx, input: TransactionInput, userId: string) {
	const [current] = await tx
		.select({ invoiceId: transaction.invoiceId })
		.from(transaction)
		.where(eq(transaction.id, input.id))
		.for('update');
	if (!current) throw new ServiceError('Transaksi tidak ditemukan.');
	const overhead = await checkRefs(tx, input, false);
	const inv = await checkInvoice(tx, input, overhead, current.invoiceId);
	const [row] = await tx
		.update(transaction)
		.set(values(input, overhead))
		.where(eq(transaction.id, input.id))
		.returning();

	let verb = 'diubah';
	if (inv && inv.id !== current.invoiceId) verb = `dihubungkan ke ${inv.number}`;
	else if (!row.invoiceId && current.invoiceId) {
		const [left] = await tx
			.select({ number: invoice.number })
			.from(invoice)
			.where(eq(invoice.id, current.invoiceId));
		verb = `dilepas dari ${left?.number ?? 'invoice'}`;
	}
	await logTransaction(tx, row, verb, 'updated', userId);

	if (current.invoiceId && current.invoiceId !== row.invoiceId)
		await syncInvoiceStatus(tx, current.invoiceId, userId);
	if (row.invoiceId) await syncInvoiceStatus(tx, row.invoiceId, userId);
	return row;
}

export async function updateTransaction(db: DbOrTx, input: TransactionInput, userId: string) {
	return db.transaction((tx) => updateTransactionTx(tx, input, userId));
}

export async function deleteTransaction(db: DbOrTx, id: string, userId: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx.delete(transaction).where(eq(transaction.id, id)).returning();
		if (!row) throw new ServiceError('Transaksi tidak ditemukan.');
		await logTransaction(tx, row, 'dihapus', 'deleted', userId);
		if (row.invoiceId) await syncInvoiceStatus(tx, row.invoiceId, userId);
		return row;
	});
}
