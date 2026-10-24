// Payments against invoices (P2-07): status follows the paid amount, also when the transaction is
// edited or deleted on Keuangan. Rolled-back transaction on the Neon `dev` branch or localhost only.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, category, invoice, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { invoiceSchema, paymentSchema } from '../../schemas/invoice';
import { transactionSchema } from '../../schemas/transaction';
import { createClient } from './clients';
import { ServiceError } from './errors';
import { deleteInvoicePayment, getInvoicePayments, recordPayment } from './invoice-payments';
import { createInvoice, listInvoices, markInvoiceSent } from './invoices';
import { updateTransaction } from './transactions';

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

const errorOf = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(e) => (e instanceof ServiceError ? e.message : String(e))
	);

describe.skipIf(!isDevDb)('invoice payments (dev database)', { timeout: 120_000 }, () => {
	it('moves sent → partial → paid, follows edits and deletes, and refuses too much', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Bayar Invoice' }), userId);
			// subtotal 45.000.000, PPN 4.950.000, total 49.950.000, PPh 23 900.000 → 49.050.000 in cash
			const inv = await createInvoice(
				tx,
				invoiceSchema.parse({
					clientId: c.id,
					issueDate: '2099-01-15',
					dueDate: '2099-01-29',
					items: [
						{ description: 'Pengembangan dashboard', qty: 1, unitPrice: 40_000_000 },
						{ description: 'Pendampingan', qty: 2.5, unitPrice: 2_000_000 }
					]
				}),
				userId
			);
			const [termin] = await tx
				.select({ id: category.id })
				.from(category)
				.where(and(eq(category.type, 'income'), eq(category.name, 'Termin')));
			const pay = (amount: number, fields: Record<string, unknown> = {}) =>
				recordPayment(
					tx,
					inv.id,
					paymentSchema.parse({
						date: '2099-01-20',
						amount,
						categoryId: termin.id,
						...fields
					}),
					userId
				);
			const statusOf = async () =>
				(await tx.select({ s: invoice.status }).from(invoice).where(eq(invoice.id, inv.id)))[0].s;

			expect(await errorOf(pay(1_000_000))).toMatch(/Tandai invoice terkirim dulu/);
			await markInvoiceSent(tx, inv.id, userId);

			const first = await pay(20_000_000, { reference: 'TRF-001' });
			expect(first.status).toBe('partial');
			expect((await listInvoices(tx, { clientId: c.id })).rows[0].paid).toBe(20_000_000);
			expect(first.transaction).toMatchObject({
				type: 'income',
				status: 'paid',
				clientId: c.id,
				invoiceId: inv.id,
				description: `Pembayaran ${inv.number}`,
				reference: 'TRF-001'
			});

			// more than the invoice total is refused and nothing is written
			expect(await errorOf(pay(30_000_000))).toMatch(/melebihi nilai invoice/);
			expect((await getInvoicePayments(tx, inv)).rows).toHaveLength(1);

			// the cash after PPh 23 completes it
			expect((await pay(29_050_000)).status).toBe('paid');
			expect(await errorOf(pay(1))).toBe('Invoice ini sudah lunas.');
			const balance = await getInvoicePayments(tx, inv);
			expect([balance.paid, balance.expected, balance.remaining]).toEqual([
				49_050_000, 49_050_000, 0
			]);

			// edited on Keuangan: amount down → partial again; moving it to another client is refused
			const edit = (fields: Record<string, unknown>) =>
				updateTransaction(
					tx,
					transactionSchema.parse({
						id: first.transaction.id,
						type: 'income',
						status: 'paid',
						date: '2099-01-20',
						amount: 20_000_000,
						clientId: c.id,
						categoryId: termin.id,
						...fields
					}),
					userId
				);
			await edit({ amount: 10_000_000 });
			expect(await statusOf()).toBe('partial');
			const other = await createClient(tx, clientSchema.parse({ name: 'ZZ Klien Lain' }), userId);
			expect(await errorOf(edit({ clientId: other.id }))).toMatch(/harus pemasukan dari klien/);
			await edit({ status: 'planned' });
			expect(await statusOf()).toBe('partial');

			// delete: only from its own invoice; with nothing paid it is sent again (due 2099)
			expect(await errorOf(deleteInvoicePayment(tx, c.id, first.transaction.id, userId))).toBe(
				'Pembayaran tidak ditemukan.'
			);
			for (const p of balance.rows) await deleteInvoicePayment(tx, inv.id, p.id, userId);
			expect(await statusOf()).toBe('sent');

			const logs = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(eq(activity.clientId, c.id));
			const bodies = logs.map((l) => l.body);
			expect(bodies).toContain(`Invoice ${inv.number} lunas (Rp 49.050.000 diterima)`);
			expect(bodies).toContain(`Invoice ${inv.number} tidak lagi lunas`);
		});
	});

	it('is overdue again when the last payment of a past-due invoice is deleted', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Bayar Lewat' }), userId);
			const inv = await createInvoice(
				tx,
				invoiceSchema.parse({
					clientId: c.id,
					issueDate: '2020-01-02',
					dueDate: '2020-01-16',
					pph23Rate: 0,
					items: [{ description: 'Audit sistem', qty: 1, unitPrice: 10_000_000 }]
				}),
				userId
			);
			await markInvoiceSent(tx, inv.id, userId);
			const [cat] = await tx
				.select({ id: category.id })
				.from(category)
				.where(eq(category.type, 'income'))
				.limit(1);
			const { transaction, status } = await recordPayment(
				tx,
				inv.id,
				paymentSchema.parse({ date: '2020-02-01', amount: '5000000', categoryId: cat.id }),
				userId
			);
			expect(status).toBe('partial');
			await deleteInvoicePayment(tx, inv.id, transaction.id, userId);
			expect(
				(await tx.select({ s: invoice.status }).from(invoice).where(eq(invoice.id, inv.id)))[0].s
			).toBe('overdue');
		});
	});
});
