// Database tests for transactions and finance totals. Neon `dev` branch (or localhost) only, inside a
// transaction that is always rolled back.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, category, project, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { transactionSchema } from '../../schemas/transaction';
import { archiveClient, createClient } from './clients';
import { ServiceError } from './errors';
import {
	createTransaction,
	deleteTransaction,
	financeTotals,
	listTransactions,
	updateTransaction
} from './transactions';

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

/** A fresh client plus one income and one expense category (created if the seed has none) */
async function setup(tx: Tx, userId: string, name = 'ZZ Test Keuangan') {
	const c = await createClient(tx, clientSchema.parse({ name }), userId);
	const cat = async (type: 'income' | 'expense', n: string) => {
		const [existing] = await tx
			.select({ id: category.id })
			.from(category)
			.where(and(eq(category.type, type), eq(category.name, n)));
		if (existing) return existing.id;
		const [row] = await tx.insert(category).values({ type, name: n }).returning();
		return row.id;
	};
	return {
		clientId: c.id,
		income: await cat('income', 'Termin'),
		expense: await cat('expense', 'Freelancer')
	};
}

const input = (fields: Record<string, unknown>) => transactionSchema.parse(fields);

describe.skipIf(!isDevDb)('transactions service (dev database)', { timeout: 90_000 }, () => {
	it('computes paid totals, profit, margin and planned income', async () => {
		await inRollback(async (tx, userId) => {
			const s = await setup(tx, userId);
			const add = (
				type: 'income' | 'expense',
				status: 'paid' | 'planned',
				amount: number,
				date: string
			) =>
				createTransaction(
					tx,
					input({
						type,
						status,
						amount,
						date,
						clientId: s.clientId,
						categoryId: type === 'income' ? s.income : s.expense,
						description: `${type} ${status} ${amount}`
					}),
					userId
				);
			await add('income', 'paid', 40_000_000, '2030-01-10');
			await add('income', 'paid', 10_000_000, '2030-02-10');
			await add('expense', 'paid', 12_500_000, '2030-01-20');
			await add('income', 'planned', 30_000_000, '2030-03-01');
			await add('expense', 'planned', 2_000_000, '2030-03-02');

			const all = await financeTotals(tx, { clientId: s.clientId });
			expect(all).toMatchObject({
				income: 50_000_000,
				expense: 12_500_000,
				profit: 37_500_000,
				margin: 75,
				plannedIncome: 30_000_000,
				plannedExpense: 2_000_000,
				plannedCount: 2
			});
			const jan = await financeTotals(tx, {
				clientId: s.clientId,
				from: '2030-01-01',
				to: '2030-01-31'
			});
			expect([jan.income, jan.expense, jan.profit]).toEqual([40_000_000, 12_500_000, 27_500_000]);
		});
	});

	it('filters by search, type and period together and counts "x dari y"', async () => {
		await inRollback(async (tx, userId) => {
			const s = await setup(tx, userId);
			const rows: [string, 'income' | 'expense', string][] = [
				['DP website', 'income', '2030-01-05'],
				['Pelunasan website', 'income', '2030-06-05'],
				['Freelancer website', 'expense', '2030-01-15'],
				['Server bulanan', 'expense', '2031-01-15']
			];
			for (const [description, type, date] of rows) {
				await createTransaction(
					tx,
					input({
						type,
						amount: 1_000_000,
						date,
						clientId: s.clientId,
						categoryId: type === 'income' ? s.income : s.expense,
						description
					}),
					userId
				);
			}
			const list = (f: Record<string, string>) =>
				listTransactions(tx, { clientId: s.clientId, ...f });

			const web2030 = await list({ q: 'website', from: '2030-01-01', to: '2030-12-31' });
			expect([web2030.total, web2030.all]).toEqual([3, 4]);
			expect(web2030.rows.map((r) => r.description)).toEqual([
				'Pelunasan website',
				'Freelancer website',
				'DP website'
			]);
			const inOnly = await list({
				q: 'website',
				type: 'income',
				from: '2030-01-01',
				to: '2030-12-31'
			});
			expect([inOnly.total, inOnly.paidIncome, inOnly.paidExpense]).toEqual([2, 2_000_000, 0]);
			// category names are searchable too
			expect((await list({ q: 'freelancer' })).rows.map((r) => r.description)).toEqual([
				'Server bulanan',
				'Freelancer website'
			]);
			expect((await list({ q: 'tidak ada' })).total).toBe(0);
		});
	});

	it('logs create, edit and delete on the client timeline', async () => {
		await inRollback(async (tx, userId) => {
			const s = await setup(tx, userId);
			const base = {
				type: 'income',
				amount: 16_000_000,
				date: '2030-01-05',
				clientId: s.clientId,
				categoryId: s.income,
				description: 'DP 50%'
			};
			const row = await createTransaction(tx, input(base), userId);
			await updateTransaction(
				tx,
				input({ ...base, id: row.id, amount: 18_000_000, status: 'planned' }),
				userId
			);
			await deleteTransaction(tx, row.id, userId);
			const log = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.clientId, s.clientId), eq(activity.type, 'transaction')))
				.orderBy(activity.occurredAt);
			expect(log.map((l) => l.body)).toEqual([
				'Pemasukan Rp 16.000.000 dicatat: DP 50%',
				'Pemasukan Rp 18.000.000 (direncanakan) diubah: DP 50%',
				'Pemasukan Rp 18.000.000 (direncanakan) dihapus: DP 50%'
			]);
			expect((await financeTotals(tx, { clientId: s.clientId })).plannedIncome).toBe(0);
		});
	});

	it("refuses a category of the other type, another client's project and archived clients", async () => {
		await inRollback(async (tx, userId) => {
			const s = await setup(tx, userId);
			const other = await setup(tx, userId, 'ZZ Test Keuangan Lain');
			const [p] = await tx
				.insert(project)
				.values({ clientId: other.clientId, name: 'Proyek lain', position: 'a0' })
				.returning();
			const base = { type: 'income', amount: 1_000, date: '2030-01-05', clientId: s.clientId };

			const fieldOf = (p: Promise<unknown>) =>
				p.then(
					() => null,
					(e) => (e instanceof ServiceError ? e.field : String(e))
				);
			expect(
				await fieldOf(createTransaction(tx, input({ ...base, categoryId: s.expense }), userId))
			).toBe('categoryId');
			expect(
				await fieldOf(
					createTransaction(tx, input({ ...base, categoryId: s.income, projectId: p.id }), userId)
				)
			).toBe('projectId');
			await archiveClient(tx, s.clientId, userId);
			expect(
				await fieldOf(createTransaction(tx, input({ ...base, categoryId: s.income }), userId))
			).toBe('clientId');
			expect(
				transactionSchema.safeParse({ ...base, categoryId: s.income, amount: 0 }).success
			).toBe(false);
		});
	});
});
