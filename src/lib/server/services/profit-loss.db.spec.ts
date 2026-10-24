// Overhead costs and Laba Rugi (P2-08), in a rolled-back transaction on the Neon `dev` branch or
// localhost only. Uses the year 2099 so real data does not mix in.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, category, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { transactionSchema } from '../../schemas/transaction';
import { createClient } from './clients';
import { ServiceError } from './errors';
import { profitLoss } from './profit-loss';
import { createTransaction, listTransactions, updateTransaction } from './transactions';

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

describe.skipIf(!isDevDb)('overhead and Laba Rugi (dev database)', { timeout: 120_000 }, () => {
	it('stores overhead without a client and splits the year into direct costs and overhead', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Laba Rugi' }), userId);
			const cat = async (type: 'income' | 'expense', name: string) =>
				(
					await tx
						.select({ id: category.id, isOverhead: category.isOverhead })
						.from(category)
						.where(and(eq(category.type, type), eq(category.name, name)))
				)[0];
			const termin = await cat('income', 'Termin');
			const vendor = await cat('expense', 'Vendor / Subkontraktor');
			const gaji = await cat('expense', 'Gaji');
			expect(gaji.isOverhead).toBe(true);
			const add = (fields: Record<string, unknown>) =>
				createTransaction(
					tx,
					transactionSchema.parse({ status: 'paid', clientId: c.id, ...fields }),
					userId
				);

			await add({ type: 'income', date: '2099-03-10', amount: 50_000_000, categoryId: termin.id });
			await add({ type: 'expense', date: '2099-03-12', amount: 10_000_000, categoryId: vendor.id });
			// an overhead category drops the client, even when one is sent
			const salary = await add({
				type: 'expense',
				date: '2099-03-25',
				amount: 15_000_000,
				categoryId: gaji.id,
				description: 'Gaji Maret'
			});
			expect([salary.clientId, salary.projectId]).toEqual([null, null]);
			await add({
				type: 'expense',
				status: 'planned',
				date: '2099-04-25',
				amount: 15_000_000,
				categoryId: gaji.id,
				clientId: ''
			});
			await add({ type: 'income', date: '2099-05-02', amount: 8_000_000, categoryId: termin.id });

			// project costs and income still need a client
			const err = await add({
				type: 'expense',
				date: '2099-03-12',
				amount: 1,
				categoryId: vendor.id,
				clientId: ''
			}).catch((e) => e);
			expect(err).toBeInstanceOf(ServiceError);
			expect((err as ServiceError).field).toBe('clientId');

			const pl = await profitLoss(tx, 2099);
			expect(pl.months[2]).toEqual({
				month: 3,
				income: 50_000_000,
				direct: 10_000_000,
				gross: 40_000_000,
				overhead: 15_000_000,
				net: 25_000_000,
				margin: 50
			});
			// planned April salary does not count
			expect(pl.months[3].overhead).toBe(0);
			expect(pl.months[4]).toMatchObject({ income: 8_000_000, net: 8_000_000, margin: 100 });
			expect(pl.total).toMatchObject({
				income: 58_000_000,
				direct: 10_000_000,
				overhead: 15_000_000,
				net: 33_000_000,
				margin: 57
			});
			expect(pl.overheadByCategory).toEqual([{ name: 'Gaji', amount: 15_000_000 }]);

			// Keuangan lists overhead rows (no client) next to the others
			const list = await listTransactions(tx, { from: '2099-03-01', to: '2099-03-31' });
			const row = list.rows.find((r) => r.id === salary.id)!;
			expect([row.clientName, row.isOverhead, list.total]).toEqual([null, true, 3]);

			// overhead has no client timeline; moving it to a project category needs a client again
			const logs = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(eq(activity.clientId, c.id));
			expect(logs.some((l) => l.body?.includes('Gaji Maret'))).toBe(false);
			const moved = await updateTransaction(
				tx,
				transactionSchema.parse({
					id: salary.id,
					type: 'expense',
					status: 'paid',
					date: '2099-03-25',
					amount: 15_000_000,
					categoryId: vendor.id,
					clientId: c.id
				}),
				userId
			);
			expect(moved.clientId).toBe(c.id);
		});
	});
});
