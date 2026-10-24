// Database tests for services/clients.ts. Run against the Neon `dev` branch (or localhost) inside
// a transaction that is always rolled back; skipped when no dev database is configured.
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { eq } from 'drizzle-orm';
import {
	action,
	activity,
	client,
	contact,
	deal,
	project,
	strategyPlan,
	transaction,
	user
} from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { archiveClient, createClient, deleteClient, listClients } from './clients';
import { ServiceError } from './errors';

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

/** Run `fn` in a transaction and always roll it back */
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

const input = (name: string) => clientSchema.parse({ name });

describe.skipIf(!isDevDb)('clients service (dev database)', { timeout: 30_000 }, () => {
	it('counts open deals and active projects per client, not per table', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, input('ZZ Test Hitung'), userId);
			await tx.insert(deal).values([
				{ clientId: c.id, title: 'open', stage: 'proposal', position: 'a0' },
				{ clientId: c.id, title: 'won', stage: 'won', position: 'a1' }
			]);
			await tx
				.insert(project)
				.values({ clientId: c.id, name: 'p', stage: 'in_progress', position: 'a0' });
			await tx.insert(transaction).values([
				{
					clientId: c.id,
					type: 'income',
					status: 'paid',
					amount: 10_000_000,
					date: new Date().toISOString().slice(0, 10)
				},
				{
					clientId: c.id,
					type: 'expense',
					status: 'paid',
					amount: 3_000_000,
					date: new Date().toISOString().slice(0, 10)
				},
				{
					clientId: c.id,
					type: 'income',
					status: 'planned',
					amount: 99_000_000,
					date: new Date().toISOString().slice(0, 10)
				}
			]);

			const { rows, total } = await listClients(tx, { q: 'zz test hitung' });
			expect(total).toBe(1);
			expect(rows[0]).toMatchObject({ openDeals: 1, activeProjects: 1, profitYtd: 7_000_000 });
		});
	});

	it('refuses to archive a client with open work, archives one without', async () => {
		await inRollback(async (tx, userId) => {
			const busy = await createClient(tx, input('ZZ Test Sibuk'), userId);
			await tx
				.insert(deal)
				.values({ clientId: busy.id, title: 'open', stage: 'lead', position: 'a0' });
			await expect(archiveClient(tx, busy.id, userId)).rejects.toThrow(ServiceError);

			const idle = await createClient(tx, input('ZZ Test Kosong'), userId);
			await archiveClient(tx, idle.id, userId);
			const archived = await listClients(tx, { q: 'zz test', status: 'archived' });
			expect(archived.rows.map((r) => r.name)).toEqual(['ZZ Test Kosong']);
		});
	});

	it('finds clients by contact name and counts them correctly', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, input('ZZ Test Kontak'), userId);
			await tx.insert(contact).values({ clientId: c.id, name: 'Qwertyuiop Zxcv', isPrimary: true });
			const { rows, total } = await listClients(tx, { q: 'qwertyuiop' });
			expect(total).toBe(1);
			expect(rows[0]).toMatchObject({ name: 'ZZ Test Kontak', contactName: 'Qwertyuiop Zxcv' });
		});
	});

	it('deletes an archived client with its records, but never one with money records', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Hapus Klien' }), userId);
			const errorOf = (p: Promise<unknown>) =>
				p.then(
					() => null,
					(e) => (e instanceof ServiceError ? e.message : String(e))
				);
			expect(await errorOf(deleteClient(tx, c.id))).toBe(
				'Arsipkan klien dulu sebelum menghapusnya.'
			);

			await tx.insert(contact).values({ clientId: c.id, name: 'Bu Rina' });
			const [d] = await tx
				.insert(deal)
				.values({
					clientId: c.id,
					title: 'Deal lama',
					stage: 'lost',
					lostReason: 'Harga',
					position: 'a0'
				})
				.returning();
			const [p] = await tx
				.insert(project)
				.values({
					clientId: c.id,
					dealId: d.id,
					name: 'Proyek lama',
					stage: 'done',
					position: 'a0'
				})
				.returning();
			const [plan] = await tx
				.insert(strategyPlan)
				.values({ clientId: c.id, dealId: d.id, goal: 'Closing', ownerId: userId })
				.returning();
			const due = new Date('2030-01-01T03:00:00Z');
			await tx.insert(action).values([
				{ dealId: d.id, title: 'Langkah deal', dueAt: due },
				{ projectId: p.id, title: 'Langkah proyek', dueAt: due },
				{ dealId: d.id, planId: plan.id, title: 'Langkah rencana', dueAt: due }
			]);
			await tx
				.update(client)
				.set({ archivedAt: new Date(), status: 'archived' })
				.where(eq(client.id, c.id));

			// money keeps the client
			const [t] = await tx
				.insert(transaction)
				.values({ type: 'income', date: '2030-01-05', amount: 1_000_000, clientId: c.id })
				.returning();
			expect(await errorOf(deleteClient(tx, c.id))).toMatch(
				/punya 1 transaksi, jadi tidak bisa dihapus/
			);
			await tx.delete(transaction).where(eq(transaction.id, t.id));

			await deleteClient(tx, c.id);
			expect(await tx.select().from(client).where(eq(client.id, c.id))).toHaveLength(0);
			expect(await tx.select().from(contact).where(eq(contact.clientId, c.id))).toHaveLength(0);
			expect(await tx.select().from(activity).where(eq(activity.clientId, c.id))).toHaveLength(0);
			expect(await tx.select().from(deal).where(eq(deal.id, d.id))).toHaveLength(0);
			expect(await tx.select().from(project).where(eq(project.id, p.id))).toHaveLength(0);
			expect(await tx.select().from(strategyPlan).where(eq(strategyPlan.id, plan.id))).toHaveLength(
				0
			);
			expect(await tx.select().from(action).where(eq(action.dealId, d.id))).toHaveLength(0);
		});
	});
});
