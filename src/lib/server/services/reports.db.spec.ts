// Dashboard numbers. The pure helpers always run; the database part runs on the Neon `dev` branch
// (or localhost) inside a transaction that is always rolled back. Test data lives in 2031, away
// from the demo seed, so totals can be compared exactly.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '../../period';
import { createDb, type Tx } from '../db/client';
import { category, client, deal, transaction, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { createClient } from './clients';
import { createDeal } from './deals';
import {
	clientTotals,
	dashboardKpis,
	pipelineSummary,
	shortClientName,
	timeSeries,
	topClientsByProfit,
	topClientsSeries,
	type ClientTotal
} from './reports';
import { financeTotals } from './transactions';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const url = process.env.DATABASE_URL;
const isDevDb =
	!!url &&
	(process.env.NEON_BRANCH === 'dev' || ['localhost', '127.0.0.1'].includes(new URL(url).hostname));

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx, userId: string) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			await fn(tx, u.id);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

const row = (name: string, income: number, expense: number): ClientTotal => ({
	clientId: name,
	name,
	income,
	expense
});

describe('report helpers', () => {
	it('drops the legal form from axis labels', () => {
		expect(shortClientName('PT Surya Daya Mandiri')).toBe('Surya Daya Mandiri');
		expect(shortClientName('CV. Garuda Manufaktur')).toBe('Garuda Manufaktur');
		expect(shortClientName('PT Bank Contoh Tbk')).toBe('Bank Contoh');
		expect(shortClientName('Yayasan Bina Cendekia')).toBe('Yayasan Bina Cendekia');
	});

	it('keeps the top 10 by income and folds the rest into Lainnya without losing money', () => {
		const rows = Array.from({ length: 13 }, (_, i) => row(`Klien ${i + 1}`, (13 - i) * 1000, 100));
		const { series, others } = topClientsSeries(rows);
		expect(series).toHaveLength(11);
		expect(others).toBe(3);
		expect(series[10]).toMatchObject({
			label: 'Lainnya',
			income: 3000 + 2000 + 1000,
			expense: 300
		});
		const sum = (xs: { income: number }[]) => xs.reduce((s, x) => s + x.income, 0);
		expect(sum(series)).toBe(sum(rows));
	});

	it('ranks Klien Teratas by profit, not income', () => {
		const top = topClientsByProfit([row('A', 100, 90), row('B', 50, 0), row('C', 80, 100)]);
		expect(top.map((t) => [t.name, t.profit, t.margin])).toEqual([
			['B', 50, 100],
			['A', 10, 10],
			['C', -20, -25]
		]);
	});
});

describe.skipIf(!isDevDb)('reports (dev database)', { timeout: 90_000 }, () => {
	it('Waktu, Klien and Keuangan totals agree for the same period', async () => {
		await inRollback(async (tx, userId) => {
			const [inc] = await tx
				.select({ id: category.id })
				.from(category)
				.where(and(eq(category.type, 'income'), eq(category.name, 'Termin')));
			const [exp] = await tx
				.select({ id: category.id })
				.from(category)
				.where(and(eq(category.type, 'expense'), eq(category.name, 'Freelancer')));
			const a = await createClient(tx, clientSchema.parse({ name: 'PT ZZ Laporan A' }), userId);
			const b = await createClient(tx, clientSchema.parse({ name: 'CV ZZ Laporan B' }), userId);
			const add = (
				clientId: string,
				type: 'income' | 'expense',
				amount: number,
				date: string,
				status: 'paid' | 'planned' = 'paid'
			) =>
				tx.insert(transaction).values({
					clientId,
					type,
					amount,
					date,
					status,
					categoryId: type === 'income' ? inc.id : exp.id
				});
			await add(a.id, 'income', 40_000_000, '2031-03-03');
			await add(a.id, 'expense', 5_000_000, '2031-03-20');
			await add(b.id, 'income', 12_000_000, '2031-03-31');
			await add(b.id, 'expense', 2_500_000, '2031-03-01');
			await add(a.id, 'income', 99_000_000, '2031-03-15', 'planned'); // not paid: never counted
			await add(a.id, 'income', 7_000_000, '2031-02-28'); // previous month

			const p = resolvePeriod({ period: 'month', from: '2031-03-10' }, { today: '2031-03-31' });
			const [series, clients, totals, kpis] = await Promise.all([
				timeSeries(tx, p),
				clientTotals(tx, p),
				financeTotals(tx, { from: p.from, to: p.to }),
				dashboardKpis(tx, p)
			]);
			const march = series.at(-1)!;
			const feb = series.at(-2)!;
			expect(series.map((s) => s.key)).toEqual([
				'2030-10-01',
				'2030-11-01',
				'2030-12-01',
				'2031-01-01',
				'2031-02-01',
				'2031-03-01'
			]);
			expect([march.income, march.expense]).toEqual([52_000_000, 7_500_000]);
			expect([feb.income, feb.expense]).toEqual([7_000_000, 0]);
			const sum = (k: 'income' | 'expense') => clients.reduce((s, c) => s + c[k], 0);
			expect([sum('income'), sum('expense')]).toEqual([march.income, march.expense]);
			expect([totals.income, totals.expense]).toEqual([march.income, march.expense]);
			expect([kpis.current.profit, kpis.previous.income]).toEqual([44_500_000, 7_000_000]);
			expect(clients.map((c) => c.name)).toEqual(['PT ZZ Laporan A', 'CV ZZ Laporan B']);

			// Mingguan buckets start on Monday, like Postgres date_trunc('week')
			const w = resolvePeriod({ period: 'week', from: '2031-03-05' }, { today: '2031-03-31' });
			const weeks = await timeSeries(tx, w);
			expect(weeks.at(-1)).toEqual({ key: '2031-03-03', income: 40_000_000, expense: 0 });
		});
	});

	it('pipeline: active in the period vs the current position', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Pipeline Laporan' }), userId);
			const p = resolvePeriod({ period: 'month', from: '2031-03-01' }, { today: '2031-03-31' });
			const before = await dashboardKpis(tx, p);
			const summaryBefore = await pipelineSummary(tx);
			const mk = async (title: string, stage: string, value: number) =>
				createDeal(
					tx,
					dealSchema.parse({
						clientId: c.id,
						title,
						stage,
						valueEstimate: value,
						firstStepTitle: 'Langkah pertama',
						firstStepDue: '2031-03-10T10:00'
					}),
					userId
				);
			await mk('Terbuka', 'proposal', 30_000_000);
			const lostEarly = await mk('Batal sebelum periode', 'lead', 5_000_000);
			await tx
				.update(deal)
				.set({ stage: 'lost', lostReason: 'Harga', lostAt: new Date('2031-02-10T03:00:00Z') })
				.where(eq(deal.id, lostEarly.id));
			const after = await dashboardKpis(tx, p);
			expect(after.pipeline.value - before.pipeline.value).toBe(30_000_000);
			expect(after.pipeline.count - before.pipeline.count).toBe(1);
			const summaryAfter = await pipelineSummary(tx);
			const proposal = (s: typeof summaryAfter) => s.stages.find((x) => x.stage === 'proposal')!;
			expect(proposal(summaryAfter).value - proposal(summaryBefore).value).toBe(30_000_000);
			expect(summaryAfter.value - summaryBefore.value).toBe(30_000_000);

			// an archived client leaves the pipeline tile, even for deals active in the period
			await tx.update(client).set({ archivedAt: new Date() }).where(eq(client.id, c.id));
			const archived = await dashboardKpis(tx, p);
			expect([archived.pipeline.value, archived.pipeline.count]).toEqual([
				before.pipeline.value,
				before.pipeline.count
			]);
		});
	});
});
