// Daily digest and Telegram linking. Neon `dev` branch (or localhost) only, inside a transaction
// that is always rolled back. Uses its own throwaway user so the seed's steps don't count, and fake
// senders, so nothing is really sent.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { client, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { stepSchema } from '../../schemas/step';
import { addAction } from './actions';
import { createClient } from './clients';
import { createDeal } from './deals';
import {
	digestEmail,
	digestTelegram,
	getDigestItems,
	runDailyDigest,
	sendDigest,
	type DigestSenders
} from './digest';
import { createLinkCode, linkTelegram, unlinkTelegram } from './telegram-link';

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

async function inRollback(fn: (tx: Tx) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			await fn(tx);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

/** 10 Mar 2031, 09:00 WIB */
const NOW = new Date('2031-03-10T02:00:00Z');
const ID = 'zz-digest-user';

async function setup(tx: Tx) {
	await tx.insert(user).values({
		id: ID,
		name: 'Uji Ringkasan',
		email: 'zz-digest@befisien.test',
		digestEnabled: true
	});
	const c = await createClient(tx, clientSchema.parse({ name: 'PT ZZ <Digest> & Co' }), ID);
	const d = await createDeal(
		tx,
		dealSchema.parse({
			clientId: c.id,
			title: 'Deal ringkasan',
			ownerId: ID,
			firstStepTitle: 'Langkah lusa',
			firstStepDue: '2031-03-12T10:00' // day after tomorrow: not in the digest
		}),
		ID
	);
	const step = (title: string, dueDate: string, dueTime = '', allDay = false) =>
		addAction(
			tx,
			{ dealId: d.id },
			stepSchema.parse({ title, dueDate, dueTime, allDay, assigneeId: ID }),
			ID
		);
	await step('Kirim proposal <final>', '2031-03-09', '14:00');
	await step('Telepon klien', '2031-03-10', '16:00');
	await step('Siapkan demo', '2031-03-10', '', true);
	await step('Rapat internal', '2031-03-10', '08:30'); // earlier today: already late at 09:00
	await step('Kick-off', '2031-03-11', '10:00');
	return { clientId: c.id };
}

const fakeSenders = () => {
	const sent: { telegram: string[]; email: { to: string; subject: string }[] } = {
		telegram: [],
		email: []
	};
	const senders: DigestSenders = {
		telegram: async (_chat, html) => void sent.telegram.push(html),
		email: async (mail) => void sent.email.push({ to: mail.to, subject: mail.subject })
	};
	return { sent, senders };
};
const me = (tx: Tx) =>
	tx
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			telegramChatId: user.telegramChatId,
			digestChannels: user.digestChannels
		})
		.from(user)
		.where(eq(user.id, ID))
		.then((r) => r[0]);

describe.skipIf(!isDevDb)('daily digest (dev database)', { timeout: 120_000 }, () => {
	it('groups late, today (with times) and tomorrow in WIB, and leaves out the rest', async () => {
		await inRollback(async (tx) => {
			await setup(tx);
			const d = await getDigestItems(tx, ID, NOW);
			expect({
				late: d.late.map((i) => i.title),
				today: d.today.map((i) => i.title),
				tomorrow: d.tomorrow.map((i) => i.title),
				total: d.total
			}).toEqual({
				late: ['Kirim proposal <final>', 'Rapat internal'],
				today: ['Siapkan demo', 'Telepon klien'],
				tomorrow: ['Kick-off'],
				total: 5
			});

			const ctx = { name: 'Uji Ringkasan', now: NOW, appUrl: 'https://crm.example' };
			const tg = digestTelegram(d, ctx);
			expect(tg).toContain('<b>Ringkasan Befisien · Senin, 10 Mar 2031</b>');
			expect(tg).toContain('Halo Uji, 2 terlambat · 2 hari ini · 1 besok.');
			expect(tg).toContain('• 9 Mar 14:00  Kirim proposal &lt;final&gt;');
			expect(tg).toContain('• Sepanjang hari  Siapkan demo');
			expect(tg).toContain('• 16:00  Telepon klien');
			expect(tg).toContain('<i>PT ZZ &lt;Digest&gt; &amp; Co · Deal ringkasan</i>');
			expect(tg).toContain('<a href="https://crm.example/strategy">Buka Strategi</a>');
			const mail = digestEmail(d, ctx);
			expect(mail.subject).toBe('Ringkasan 10 Mar 2031: 2 terlambat · 2 hari ini · 1 besok');
			expect(mail.html).toContain('Buka Strategi');
			expect(mail.html).not.toContain('<final>');
			expect(mail.text).toContain('- 10:00  Kick-off (PT ZZ <Digest> & Co · Deal ringkasan)');
		});
	});

	it('sends on the chosen channels, skips empty days, and one failing channel does not stop the other', async () => {
		await inRollback(async (tx) => {
			await setup(tx);
			const opts = (senders: DigestSenders) => ({
				now: NOW,
				appUrl: 'https://crm.example',
				senders
			});

			// not linked yet: email only
			let f = fakeSenders();
			let r = await sendDigest(tx, await me(tx), opts(f.senders));
			expect([r.telegram, r.mail, f.sent.email[0].to]).toEqual([
				'not-linked',
				'sent',
				'zz-digest@befisien.test'
			]);

			// linked, Telegram fails: email still goes out, the error is reported
			await tx.update(user).set({ telegramChatId: '12345' }).where(eq(user.id, ID));
			f = fakeSenders();
			r = await sendDigest(tx, await me(tx), {
				...opts(f.senders),
				senders: { ...f.senders, telegram: async () => Promise.reject(new Error('Telegram 403')) }
			});
			expect([r.telegram, r.mail, r.errors]).toEqual(['failed', 'sent', ['Error: Telegram 403']]);

			// email switched off
			await tx
				.update(user)
				.set({ digestChannels: ['telegram'] })
				.where(eq(user.id, ID));
			f = fakeSenders();
			r = await sendDigest(tx, await me(tx), opts(f.senders));
			expect([r.telegram, r.mail, f.sent.telegram.length, f.sent.email.length]).toEqual([
				'sent',
				'off',
				1,
				0
			]);

			// a day with nothing due (one year earlier): nothing at all is sent
			f = fakeSenders();
			r = await sendDigest(tx, await me(tx), {
				...opts(f.senders),
				now: new Date('2030-03-10T02:00:00Z')
			});
			expect([r.total, r.telegram, r.mail, f.sent.telegram.length]).toEqual([
				0,
				'skipped',
				'skipped',
				0
			]);
		});
	});

	it('runs for users with the digest on and leaves archived clients out', async () => {
		await inRollback(async (tx) => {
			const { clientId } = await setup(tx);
			// archived client: its steps leave the digest
			await tx.update(client).set({ archivedAt: new Date() }).where(eq(client.id, clientId));
			expect((await getDigestItems(tx, ID, NOW)).total).toBe(0);
			await tx.update(client).set({ archivedAt: null }).where(eq(client.id, clientId));

			await tx.update(user).set({ digestEnabled: false }).where(eq(user.id, ID));
			const f = fakeSenders();
			const results = await runDailyDigest(tx, { now: NOW, appUrl: 'x', senders: f.senders });
			expect(results.find((r) => r.userId === ID)).toBeUndefined();
		});
	});

	it('links Telegram with a one-time code that expires', async () => {
		await inRollback(async (tx) => {
			await setup(tx);
			const { code } = await createLinkCode(tx, ID, NOW);
			expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
			expect(await linkTelegram(tx, 'SALAH12345', '999', NOW)).toBeNull();
			expect(await linkTelegram(tx, code.toLowerCase(), '999', NOW)).toEqual({
				id: ID,
				name: 'Uji Ringkasan'
			});
			expect((await me(tx)).telegramChatId).toBe('999');
			// the code works once
			expect(await linkTelegram(tx, code, '888', NOW)).toBeNull();

			const late = await createLinkCode(tx, ID, NOW);
			expect(
				await linkTelegram(tx, late.code, '777', new Date(NOW.getTime() + 16 * 60_000))
			).toBeNull();

			expect(await unlinkTelegram(tx, { chatId: '999' })).toEqual([
				{ id: ID, name: 'Uji Ringkasan' }
			]);
			expect((await me(tx)).telegramChatId).toBeNull();
		});
	});
});
