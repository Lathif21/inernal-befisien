// Dashboard numbers. Relative imports only: shared with Trigger.dev (the digest reuses them).
// Every money figure here is built from paid transactions with the same filters as Keuangan
// (services/transactions.ts), so the Dashboard, Keuangan and the client pages always agree.
import { and, asc, desc, eq, gte, inArray, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { OPEN_DEAL_STAGES, type DealStage } from '../../constants';
import { bucketStarts, type ResolvedPeriod } from '../../period';
import type { DbOrTx } from '../db/client';
import { client, deal, transaction } from '../db/schema/index';
import { financeTotals } from './transactions';

const sumWhere = (type: 'income' | 'expense') =>
	sql<number>`coalesce(sum(${transaction.amount}) filter (where ${transaction.type} = ${type}), 0)::bigint`.mapWith(
		Number
	);

const paidBetween = (from: string, to: string) =>
	and(eq(transaction.status, 'paid'), gte(transaction.date, from), lte(transaction.date, to));

// ---------- KPI tiles ----------

/**
 * "Nilai pipeline aktif" for a period: deals that were open at some point in it. Created before
 * the period ended, and either still open or won / lost after it started. Uses today's value
 * estimate (history of estimates is not kept).
 */
async function activePipeline(db: DbOrTx, from: Date, to: Date) {
	const [row] = await db
		.select({
			value: sql<number>`coalesce(sum(${deal.valueEstimate}), 0)::bigint`.mapWith(Number),
			count: sql<number>`count(*)::int`
		})
		.from(deal)
		.where(
			and(
				lt(deal.createdAt, to),
				or(
					notInArray(deal.stage, ['won', 'lost']),
					and(eq(deal.stage, 'won'), gte(deal.wonAt, from)),
					and(eq(deal.stage, 'lost'), gte(deal.lostAt, from))
				)
			)
		);
	return row;
}

/** The four tiles for the period and the previous period of the same length */
export async function dashboardKpis(db: DbOrTx, p: ResolvedPeriod) {
	const prevFromInstant = new Date(
		p.fromInstant.getTime() - (p.toInstant.getTime() - p.fromInstant.getTime())
	);
	const [current, previous, pipeline, pipelinePrev] = await Promise.all([
		financeTotals(db, { from: p.from, to: p.to }),
		financeTotals(db, { from: p.prevFrom, to: p.prevTo }),
		activePipeline(db, p.fromInstant, p.toInstant),
		activePipeline(db, prevFromInstant, p.fromInstant)
	]);
	return { current, previous, pipeline, pipelinePrev };
}

// ---------- "Pemasukan vs Pengeluaran" ----------

export type SeriesPoint = { key: string; income: number; expense: number };

/** View by Waktu: paid income / expense per bucket from `seriesFrom` to the end of the period */
export async function timeSeries(db: DbOrTx, p: ResolvedPeriod): Promise<SeriesPoint[]> {
	// The bucket name is inlined (it is one of four fixed words): as a bind parameter Postgres
	// could not match the SELECT expression with the GROUP BY one
	const unit = sql.raw(`'${p.bucket}'`);
	const bucket = sql`to_char(date_trunc(${unit}, ${transaction.date}::timestamp), 'YYYY-MM-DD')`;
	const rows = await db
		.select({
			key: sql<string>`${bucket}`,
			income: sumWhere('income'),
			expense: sumWhere('expense')
		})
		.from(transaction)
		.where(paidBetween(p.seriesFrom, p.to))
		.groupBy(bucket);
	const byKey = new Map(rows.map((r) => [r.key, r]));
	// Every bucket gets a slot, also the empty ones
	return bucketStarts(p.seriesFrom, p.to, p.bucket).map((key) => ({
		key,
		income: byKey.get(key)?.income ?? 0,
		expense: byKey.get(key)?.expense ?? 0
	}));
}

/** Paid income / expense per client in the period, highest income first */
export async function clientTotals(db: DbOrTx, p: ResolvedPeriod) {
	const income = sumWhere('income');
	return db
		.select({
			clientId: client.id,
			name: client.name,
			income,
			expense: sumWhere('expense')
		})
		.from(transaction)
		.innerJoin(client, eq(client.id, transaction.clientId))
		.where(paidBetween(p.from, p.to))
		.groupBy(client.id, client.name)
		.orderBy(desc(income), desc(sumWhere('expense')), asc(client.name));
}

export type ClientTotal = Awaited<ReturnType<typeof clientTotals>>[number];

/** "PT Surya Daya Mandiri" → "Surya Daya Mandiri" (axis labels drop the legal form) */
export function shortClientName(name: string) {
	return name.replace(/^(PT|CV|UD)\.?\s+/i, '').replace(/,?\s+Tbk\.?$/i, '') || name;
}

/** View by Klien: top `limit` clients by income, the rest folded into "Lainnya" */
export function topClientsSeries(rows: ClientTotal[], limit = 10) {
	const top = rows.slice(0, limit).map((r) => ({
		key: r.clientId,
		label: shortClientName(r.name),
		name: r.name,
		income: r.income,
		expense: r.expense
	}));
	const rest = rows.slice(limit);
	if (rest.length) {
		top.push({
			key: 'lainnya',
			label: 'Lainnya',
			name: `Lainnya (${rest.length} klien)`,
			income: rest.reduce((s, r) => s + r.income, 0),
			expense: rest.reduce((s, r) => s + r.expense, 0)
		});
	}
	return { series: top, others: rest.length };
}

/** "Klien Teratas": top 5 by profit in the period */
export function topClientsByProfit(rows: ClientTotal[], limit = 5) {
	return rows
		.map((r) => ({ ...r, profit: r.income - r.expense }))
		.sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name))
		.slice(0, limit)
		.map((r) => ({ ...r, margin: r.income > 0 ? Math.round((r.profit / r.income) * 100) : null }));
}

// ---------- "Ringkasan Pipeline" (current position, not the period) ----------

export async function pipelineSummary(db: DbOrTx) {
	const rows = await db
		.select({
			stage: deal.stage,
			count: sql<number>`count(*)::int`,
			value: sql<number>`coalesce(sum(${deal.valueEstimate}), 0)::bigint`.mapWith(Number)
		})
		.from(deal)
		.innerJoin(client, eq(client.id, deal.clientId))
		.where(and(inArray(deal.stage, [...OPEN_DEAL_STAGES]), sql`${client.archivedAt} is null`))
		.groupBy(deal.stage);
	const byStage = new Map(rows.map((r) => [r.stage, r]));
	const stages = OPEN_DEAL_STAGES.map((stage: DealStage) => ({
		stage,
		count: byStage.get(stage)?.count ?? 0,
		value: byStage.get(stage)?.value ?? 0
	}));
	return {
		stages,
		count: stages.reduce((s, r) => s + r.count, 0),
		value: stages.reduce((s, r) => s + r.value, 0)
	};
}
