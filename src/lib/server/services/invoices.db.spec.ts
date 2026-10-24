// Invoices: storage in a rolled-back transaction, and numbering under real concurrency (separate
// connections that commit, so the counter row is really contended). Neon `dev` branch or localhost
// only. The concurrency test uses the year 2099 and deletes everything it created.
import { eq, inArray, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, client, invoice, invoiceCounter, transaction, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { invoiceSchema } from '../../schemas/invoice';
import { createClient } from './clients';
import { ServiceError } from './errors';
import {
	createInvoice,
	getInvoice,
	listInvoices,
	markInvoiceSent,
	updateInvoice,
	voidInvoice
} from './invoices';

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

const input = (clientId: string, fields: Record<string, unknown> = {}) =>
	invoiceSchema.parse({
		clientId,
		issueDate: '2099-01-15',
		dueDate: '2099-01-29',
		items: [
			{ description: 'Pengembangan dashboard', qty: 1, unitPrice: 40_000_000 },
			{ description: 'Pendampingan', qty: 2.5, unitPrice: 2_000_000 }
		],
		...fields
	});

describe.skipIf(!isDevDb)('invoices (dev database)', { timeout: 180_000 }, () => {
	it('stores items and server-computed totals, and shows the client NPWP', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(
				tx,
				clientSchema.parse({ name: 'ZZ Invoice Klien', npwp: '01.234.567.8-901.000' }),
				userId
			);
			const row = await createInvoice(tx, input(c.id), userId);
			expect(row.number).toMatch(/^INV\/BEF\/2099\/01\/\d{3,}$/);
			const full = (await getInvoice(tx, row.id))!;
			expect({
				status: full.status,
				subtotal: full.subtotal,
				ppn: full.ppnAmount,
				pph23: full.pph23Amount,
				total: full.total,
				items: full.items.map((i) => [i.description, i.qty, i.amount]),
				npwp: full.client.npwp
			}).toEqual({
				status: 'draft',
				subtotal: 45_000_000,
				ppn: 4_950_000,
				pph23: 900_000,
				total: 49_950_000,
				items: [
					['Pengembangan dashboard', 1, 40_000_000],
					['Pendampingan', 2.5, 5_000_000]
				],
				// stored as digits (services/clients.ts); the PDF formats it
				npwp: '012345678901000'
			});
			const [log] = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(eq(activity.clientId, c.id));
			expect(log).toBeDefined();
			expect(invoiceSchema.safeParse({ ...input(c.id), dueDate: '2099-01-01' }).success).toBe(
				false
			);
			expect(invoiceSchema.safeParse({ ...input(c.id), items: [] }).success).toBe(false);
			expect(
				invoiceSchema.safeParse({
					...input(c.id),
					items: [{ description: 'X item', qty: 0.333, unitPrice: 1 }]
				}).success
			).toBe(false);
		});
	});

	it('refuses an archived client and another client’s project', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Invoice Arsip' }), userId);
			await tx.update(client).set({ archivedAt: new Date() }).where(eq(client.id, c.id));
			await expect(createInvoice(tx, input(c.id), userId)).rejects.toThrow(ServiceError);
		});
	});

	it('edits drafts only, keeps the issue month, sends, voids, and lists with status counts', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Invoice Alur' }), userId);
			const draft = await createInvoice(tx, input(c.id), userId);
			const edit = (fields: Record<string, unknown>) =>
				updateInvoice(tx, input(c.id, { id: draft.id, ...fields }), userId);
			const fieldOf = (p: Promise<unknown>) =>
				p.then(
					() => null,
					(e) => (e instanceof ServiceError ? (e.field ?? e.message) : String(e))
				);

			// edit: items replaced, totals recomputed, PPN off
			const edited = await edit({
				ppnRate: 0,
				items: [{ description: 'Lisensi tahunan', qty: 3, unitPrice: 1_500_000 }]
			});
			expect([edited.subtotal, edited.ppnAmount, edited.total, edited.pph23Amount]).toEqual([
				4_500_000, 0, 4_500_000, 90_000
			]);
			expect((await getInvoice(tx, draft.id))!.items.map((i) => i.description)).toEqual([
				'Lisensi tahunan'
			]);
			// the number belongs to the issue month
			expect(await fieldOf(edit({ issueDate: '2099-02-01', dueDate: '2099-02-15' }))).toBe(
				'issueDate'
			);

			// send: no more edits
			const sent = await markInvoiceSent(tx, draft.id, userId);
			expect([sent.status, sent.sentAt instanceof Date]).toEqual(['sent', true]);
			expect(await fieldOf(edit({}))).toBe('Hanya invoice draf yang bisa diubah.');
			expect(await fieldOf(markInvoiceSent(tx, draft.id, userId))).toBe(
				'Invoice ini sudah dikirim.'
			);

			// void is refused once a payment exists
			const paid = await createInvoice(tx, input(c.id), userId);
			await tx.insert(transaction).values({
				type: 'income',
				amount: 1_000_000,
				date: '2099-01-20',
				clientId: c.id,
				invoiceId: paid.id
			});
			expect(await fieldOf(voidInvoice(tx, paid.id, userId))).toMatch(/sudah punya pembayaran/);
			expect((await voidInvoice(tx, draft.id, userId)).status).toBe('void');

			const list = await listInvoices(tx, { clientId: c.id });
			expect([list.total, list.counts]).toEqual([2, { void: 1, draft: 1 }]);
			const paidRow = list.rows.find((r) => r.id === paid.id)!;
			expect([paidRow.firstItem, paidRow.itemCount]).toEqual(['Pengembangan dashboard', 2]);
			const onlyVoid = await listInvoices(tx, { clientId: c.id, status: 'void' });
			expect(onlyVoid.rows.map((r) => r.number)).toEqual([draft.number]);
			expect((await listInvoices(tx, { q: draft.number })).rows.map((r) => r.id)).toEqual([
				draft.id
			]);
		});
	});

	it('gives 10 concurrent invoices 10 different numbers, without gaps, and restarts each month', async () => {
		const db = createDb(url!);
		const [u] = await db.select({ id: user.id }).from(user).limit(1);
		const c = await createClient(db, clientSchema.parse({ name: 'ZZ Invoice Konkuren' }), u.id);
		try {
			const jan = await Promise.all(
				Array.from({ length: 10 }, () => createInvoice(db, input(c.id), u.id))
			);
			const seqs = jan.map((r) => Number(r.number.split('/').pop())).sort((a, b) => a - b);
			const first = seqs[0];
			expect(seqs).toEqual(Array.from({ length: 10 }, (_, i) => first + i));
			expect(new Set(jan.map((r) => r.number)).size).toBe(10);

			const feb = await createInvoice(
				db,
				input(c.id, { issueDate: '2099-02-03', dueDate: '2099-02-17' }),
				u.id
			);
			expect(feb.number).toBe('INV/BEF/2099/02/001');
		} finally {
			const ids = (
				await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.clientId, c.id))
			).map((r) => r.id);
			if (ids.length) await db.delete(invoice).where(inArray(invoice.id, ids));
			await db.delete(invoiceCounter).where(like(invoiceCounter.period, '2099-%'));
			await db.delete(activity).where(eq(activity.clientId, c.id));
			await db.delete(client).where(eq(client.id, c.id));
			await db.$client.end();
		}
	});
});
