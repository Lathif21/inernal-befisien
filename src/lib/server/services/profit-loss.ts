// Laba Rugi (P2-08): paid transactions per month of one year. Cash basis, like every other money
// figure in the app (Profit = paid income − paid expense). Direct costs are expenses in project
// categories (with a client); overhead is expenses in overhead categories (no client).
// Relative imports only.
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { category, transaction } from '../db/schema/index';

export type ProfitLossMonth = {
	/** 1–12 */
	month: number;
	income: number;
	direct: number;
	gross: number;
	overhead: number;
	net: number;
	/** Net profit as a share of income; null without income */
	margin: number | null;
};

const sumWhere = (cond: ReturnType<typeof sql>) =>
	sql<number>`coalesce(sum(${transaction.amount}) filter (where ${cond}), 0)::bigint`.mapWith(
		Number
	);

const withTotals = (m: Omit<ProfitLossMonth, 'gross' | 'net' | 'margin'>): ProfitLossMonth => {
	const gross = m.income - m.direct;
	const net = gross - m.overhead;
	return { ...m, gross, net, margin: m.income > 0 ? Math.round((net / m.income) * 100) : null };
};

export async function profitLoss(db: DbOrTx, year: number) {
	const from = `${year}-01-01`;
	const to = `${year}-12-31`;
	const isOverhead = sql`coalesce(${category.isOverhead}, false)`;
	const month = sql<number>`extract(month from ${transaction.date})::int`;
	const inYear = and(
		eq(transaction.status, 'paid'),
		gte(transaction.date, from),
		lte(transaction.date, to)
	);

	const [rows, overheadByCategory] = await Promise.all([
		db
			.select({
				month,
				income: sumWhere(sql`${transaction.type} = 'income'`),
				direct: sumWhere(sql`${transaction.type} = 'expense' and not ${isOverhead}`),
				overhead: sumWhere(sql`${transaction.type} = 'expense' and ${isOverhead}`)
			})
			.from(transaction)
			.leftJoin(category, eq(category.id, transaction.categoryId))
			.where(inYear)
			.groupBy(month),
		db
			.select({
				name: category.name,
				amount: sql<number>`sum(${transaction.amount})::bigint`.mapWith(Number)
			})
			.from(transaction)
			.innerJoin(category, eq(category.id, transaction.categoryId))
			.where(and(inYear, eq(transaction.type, 'expense'), eq(category.isOverhead, true)))
			.groupBy(category.name)
			.orderBy(desc(sql`sum(${transaction.amount})`), category.name)
	]);

	const byMonth = new Map(rows.map((r) => [r.month, r]));
	const months = Array.from({ length: 12 }, (_, i) => {
		const r = byMonth.get(i + 1);
		return withTotals({
			month: i + 1,
			income: r?.income ?? 0,
			direct: r?.direct ?? 0,
			overhead: r?.overhead ?? 0
		});
	});
	const total = withTotals({
		month: 0,
		income: months.reduce((s, m) => s + m.income, 0),
		direct: months.reduce((s, m) => s + m.direct, 0),
		overhead: months.reduce((s, m) => s + m.overhead, 0)
	});
	return { year, months, total, overheadByCategory };
}

export type ProfitLoss = Awaited<ReturnType<typeof profitLoss>>;
