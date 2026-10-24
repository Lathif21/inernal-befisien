// Invoice jobs (P2-09): overdue marking, the 3-day team reminder and the digest's invoice lines.
// Fake senders, so nothing is really sent. Rolled-back transaction on the Neon `dev` branch or
// localhost only; dates in 2031 so real data does not mix in (other unpaid invoices on the dev
// database may still appear in the lists, so the checks look for this test's own invoices).
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, invoice, transaction, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { invoiceSchema } from '../../schemas/invoice';
import { createClient } from './clients';
import { sendDigest, type DigestSenders } from './digest';
import { invoiceAttention, markOverdueInvoices, runInvoiceReminder } from './invoice-jobs';
import { createInvoice } from './invoices';

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

/** 09:00 WIB on 10 Mar 2031 */
const NOW = new Date('2031-03-10T02:00:00Z');

function fakeSenders() {
	const sent: { channel: 'telegram' | 'email'; to: string; body: string }[] = [];
	const senders: DigestSenders = {
		telegram: async (chatId, html) =>
			void sent.push({ channel: 'telegram', to: chatId, body: html }),
		email: async (mail) => void sent.push({ channel: 'email', to: mail.to, body: mail.text })
	};
	return { sent, senders };
}

describe.skipIf(!isDevDb)('invoice jobs (dev database)', { timeout: 120_000 }, () => {
	it('marks sent invoices overdue, reminds 3 days ahead, and lists both in the digest', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Tagihan Klien' }), userId);
			const make = async (
				due: string,
				status: 'sent' | 'partial' | 'draft',
				price = 10_000_000
			) => {
				const inv = await createInvoice(
					tx,
					invoiceSchema.parse({
						clientId: c.id,
						issueDate: '2031-03-01',
						dueDate: due,
						pph23Rate: 0,
						items: [{ description: 'Jasa integrasi', qty: 1, unitPrice: price }]
					}),
					userId
				);
				await tx.update(invoice).set({ status }).where(eq(invoice.id, inv.id));
				return inv;
			};
			const late = await make('2031-03-05', 'sent');
			const partLate = await make('2031-03-05', 'partial');
			await tx.insert(transaction).values({
				type: 'income',
				date: '2031-03-04',
				amount: 4_000_000,
				clientId: c.id,
				invoiceId: partLate.id
			});
			const inThree = await make('2031-03-13', 'sent');
			const tomorrow = await make('2031-03-11', 'sent');
			const draft = await make('2031-03-01', 'draft');
			const statusOf = async (id: string) =>
				(await tx.select({ s: invoice.status }).from(invoice).where(eq(invoice.id, id)))[0].s;

			// 00:15: only "sent" past due becomes overdue; partly paid and drafts keep their status
			const marked = await markOverdueInvoices(tx, NOW);
			expect(marked.map((m) => m.number)).toContain(late.number);
			expect(marked.map((m) => m.number)).not.toContain(partLate.number);
			expect(await statusOf(late.id)).toBe('overdue');
			expect(await statusOf(partLate.id)).toBe('partial');
			expect(await statusOf(draft.id)).toBe('draft');
			const logs = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(eq(activity.clientId, c.id));
			expect(logs.map((l) => l.body)).toContain(
				`Invoice ${late.number} lewat jatuh tempo (5 Mar 2031) dan belum dibayar`
			);

			// digest lines: past due (with what is left) and due within 3 days
			const att = await invoiceAttention(tx, NOW);
			const mine = (list: { number: string }[]) =>
				list
					.map((i) => i.number)
					.filter((n) => [late, partLate, inThree, tomorrow, draft].some((x) => x.number === n));
			expect(mine(att.overdue)).toEqual([late.number, partLate.number].sort());
			expect(att.overdue.find((i) => i.number === partLate.number)?.remaining).toBe(7_100_000);
			expect(mine(att.dueSoon)).toEqual([tomorrow.number, inThree.number]);

			// a day without steps still gets the digest because of the invoices
			const f = fakeSenders();
			const r = await sendDigest(
				tx,
				{
					id: 'zz-nobody',
					name: 'Uji Tagihan',
					email: 'zz@befisien.test',
					telegramChatId: '42',
					digestChannels: ['telegram', 'email']
				},
				{ now: NOW, appUrl: 'https://crm.test', senders: f.senders, invoices: att }
			);
			expect([r.total, r.telegram, r.mail]).toEqual([0, 'sent', 'sent']);
			const tg = f.sent.find((s) => s.channel === 'telegram')!.body;
			expect(tg).toContain('Invoice lewat jatuh tempo');
			expect(tg).toContain(`${partLate.number} · ZZ Tagihan Klien · sisa Rp 7.100.000`);
			expect(tg).toContain('https://crm.test/invoices');

			// 08:00: only invoices due exactly 3 days from today, to every user with the digest on
			await tx.insert(user).values({
				id: 'zz-invoice-reminder',
				name: 'Uji Pengingat',
				email: 'zz-reminder@befisien.test',
				digestEnabled: true,
				digestChannels: ['telegram'],
				telegramChatId: '777'
			});
			const g = fakeSenders();
			const reminder = await runInvoiceReminder(tx, {
				now: NOW,
				appUrl: 'https://crm.test',
				senders: g.senders
			});
			expect(reminder.dueDate).toBe('2031-03-13');
			expect(reminder.results.find((x) => x.email === 'zz-reminder@befisien.test')).toMatchObject({
				telegram: 'sent',
				mail: 'off'
			});
			const mineSent = g.sent.find((x) => x.to === '777')!.body;
			expect(mineSent).toContain(inThree.number);
			expect(mineSent).not.toContain(tomorrow.number);
			expect(mineSent).toContain('jatuh tempo 3 hari lagi');
		});
	});
});
