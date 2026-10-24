// Transactions (money in / out) and the totals built from them. Relative imports only: shared with
// Trigger.dev. Rule 5 (docs/02-DATA-MODEL.md): every create / edit / delete logs a `transaction`
// activity, and totals are always computed by queries, never stored.
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { TXN_TYPE_LABELS, type PaymentMethod, type TxnStatus, type TxnType } from '../../constants';
import { rupiah } from '../../format';
import type { TransactionInput } from '../../schemas/transaction';
import type { DbOrTx, Tx } from '../db/client';
import { category, client, invoice, project, transaction } from '../db/schema/index';
import { logActivity } from './activity';
import { ServiceError } from './errors';
import { syncInvoiceStatus } from './invoice-status';

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
			.innerJoin(client, eq(client.id, transaction.clientId))
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
			invoiceNumber: invoice.number
		})
		.from(transaction)
		.innerJoin(client, eq(client.id, transaction.clientId))
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
		.select({ id: category.id, type: category.type, name: category.name })
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
	return { clients, projects };
}

// ---------- create / edit / delete ----------

/** Client, project and category must exist and fit together; returns the client's name */
async function checkRefs(tx: Tx, input: TransactionInput, isNew: boolean) {
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

	const [cat] = await tx
		.select({ type: category.type })
		.from(category)
		.where(eq(category.id, input.categoryId));
	if (!cat) throw new ServiceError('Kategori tidak ditemukan.', 'categoryId');
	if (cat.type !== input.type)
		throw new ServiceError(
			`Kategori ini untuk ${TXN_TYPE_LABELS[cat.type].long.toLowerCase()}.`,
			'categoryId'
		);
}

const values = (input: TransactionInput) => ({
	type: input.type,
	status: input.status,
	date: input.date,
	amount: input.amount!,
	clientId: input.clientId,
	projectId: input.projectId || null,
	categoryId: input.categoryId,
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

/** Insert + activity inside the caller's transaction; `invoiceId` links a payment (P2-07) */
export async function insertTransaction(
	tx: Tx,
	input: TransactionInput,
	userId: string,
	invoiceId: string | null = null
) {
	await checkRefs(tx, input, true);
	const [row] = await tx
		.insert(transaction)
		.values({ ...values(input), invoiceId, createdBy: userId })
		.returning();
	await logActivity(tx, {
		clientId: row.clientId,
		projectId: row.projectId,
		type: 'transaction',
		body: summary('dicatat', row),
		meta: { transactionId: row.id, action: 'created' },
		userId
	});
	return row;
}

export async function createTransaction(db: DbOrTx, input: TransactionInput, userId: string) {
	return db.transaction((tx) => insertTransaction(tx, input, userId));
}

export async function updateTransaction(db: DbOrTx, input: TransactionInput, userId: string) {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({ id: transaction.id })
			.from(transaction)
			.where(eq(transaction.id, input.id))
			.for('update');
		if (!current) throw new ServiceError('Transaksi tidak ditemukan.');
		await checkRefs(tx, input, false);
		const [row] = await tx
			.update(transaction)
			.set(values(input))
			.where(eq(transaction.id, input.id))
			.returning();
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.projectId,
			type: 'transaction',
			body: summary('diubah', row),
			meta: { transactionId: row.id, action: 'updated' },
			userId
		});
		// a payment keeps its invoice link; the invoice status follows the new amount / status
		if (row.invoiceId) await syncInvoiceStatus(tx, row.invoiceId, userId);
		return row;
	});
}

export async function deleteTransaction(db: DbOrTx, id: string, userId: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx.delete(transaction).where(eq(transaction.id, id)).returning();
		if (!row) throw new ServiceError('Transaksi tidak ditemukan.');
		await logActivity(tx, {
			clientId: row.clientId,
			projectId: row.projectId,
			type: 'transaction',
			body: summary('dihapus', row),
			meta: { transactionId: row.id, action: 'deleted' },
			userId
		});
		if (row.invoiceId) await syncInvoiceStatus(tx, row.invoiceId, userId);
		return row;
	});
}
