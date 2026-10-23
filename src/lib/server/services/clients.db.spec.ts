// Database tests for services/clients.ts. Run against the Neon `dev` branch (or localhost) inside
// a transaction that is always rolled back; skipped when no dev database is configured.
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { contact, deal, project, transaction, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { archiveClient, createClient, listClients } from './clients';
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
});
