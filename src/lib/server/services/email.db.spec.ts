// Database tests for the email inbox (P3-08). Neon `dev` branch (or localhost) only, inside a
// transaction that is always rolled back.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, contact, emailMessage, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { contactSchema } from '../../schemas/contact';
import type { OutgoingMail } from '../notify/email';
import { createClient } from './clients';
import { saveContact } from './contacts';
import {
	attachmentSource,
	getThread,
	linkThread,
	listThreads,
	markThread,
	receiveEmail,
	replyDefaults,
	sendEmailMessage,
	unreadThreadCount,
	type IncomingEmail
} from './email';

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

const run = Math.random().toString(36).slice(2, 8);
const addr = (local: string) => `${local}.${run}@zz-test.id`;

let seq = 0;
function incoming(fields: Partial<IncomingEmail> & { from: IncomingEmail['from'] }): IncomingEmail {
	seq += 1;
	return {
		resendId: `zz-${run}-${seq}`,
		messageId: `<m${seq}.${run}@mail.zz-test.id>`,
		inReplyTo: null,
		references: [],
		to: ['info@befisien.com'],
		cc: [],
		replyTo: null,
		subject: 'Penawaran integrasi ERP',
		text: 'Halo, kami tertarik dengan integrasi ERP.',
		html: null,
		attachments: [],
		bulk: false,
		sentAt: new Date(Date.now() - (100 - seq) * 60_000),
		...fields
	};
}

const inbox = { name: 'Befisien', email: 'info@befisien.com' };

function fakeSender() {
	const sent: OutgoingMail[] = [];
	const ids = new Map<string, string>();
	return {
		sent,
		deps: {
			from: inbox,
			brand: {
				logoUrl: null,
				name: 'Befisien',
				wordmark: 'BEFISIEN',
				tagline: 'Tagline uji',
				services: [],
				links: []
			},
			send: async (mail: OutgoingMail) => {
				// Same idempotency key → same Resend id, like the real API
				const key = mail.idempotencyKey ?? String(sent.length);
				if (!ids.has(key)) {
					sent.push(mail);
					ids.set(key, `zz-out-${run}-${ids.size + 1}`);
				}
				return ids.get(key)!;
			}
		}
	};
}

async function clientWithContact(tx: Tx, userId: string, email: string) {
	const c = await createClient(tx, clientSchema.parse({ name: `ZZ Email ${run}` }), userId);
	await saveContact(tx, c.id, contactSchema.parse({ name: 'Budi Santoso', email }), userId);
	return c;
}

const emailActivities = (tx: Tx, clientId: string) =>
	tx
		.select({ body: activity.body, meta: activity.meta })
		.from(activity)
		.where(eq(activity.clientId, clientId))
		.then((rows) => rows.filter((r) => (r.meta as { emailId?: string } | null)?.emailId));

describe.skipIf(!isDevDb)('email inbox service (dev database)', { timeout: 30_000 }, () => {
	it('matches a known sender to the client, logs it once and ignores a replayed webhook', async () => {
		await inRollback(async (tx, userId) => {
			const budi = addr('budi');
			const c = await clientWithContact(tx, userId, budi);
			const mail = incoming({ from: { name: 'Budi', email: budi } });

			const first = await receiveEmail(tx, mail);
			expect(first.created).toBe(true);
			expect(first.created && first.clientName).toBe(c.name);
			const again = await receiveEmail(tx, mail);
			expect(again.created).toBe(false);
			// The same message delivered again under a new Resend id is still one email
			const redelivered = await receiveEmail(tx, { ...mail, resendId: `${mail.resendId}-b` });
			expect(redelivered.created).toBe(false);

			const logged = await emailActivities(tx, c.id);
			expect(logged).toHaveLength(1);
			expect(logged[0].body).toContain('Email masuk: Penawaran integrasi ERP');
		});
	});

	it('threads a reply by In-Reply-To and gives an unknown sender in it the thread client', async () => {
		await inRollback(async (tx, userId) => {
			const budi = addr('budi');
			const c = await clientWithContact(tx, userId, budi);
			const first = incoming({ from: { name: 'Budi', email: budi } });
			const a = await receiveEmail(tx, first);
			const b = await receiveEmail(
				tx,
				incoming({
					from: { name: 'Sari', email: addr('sari') },
					subject: 'Re: Penawaran integrasi ERP',
					inReplyTo: first.messageId,
					references: [first.messageId!]
				})
			);
			const unrelated = await receiveEmail(
				tx,
				incoming({ from: { name: null, email: addr('x') } })
			);

			const thread = await getThread(tx, a.id!);
			expect(thread?.messages.map((m) => m.fromName)).toEqual(['Budi', 'Sari']);
			expect(thread?.client?.id).toBe(c.id);
			expect(b.created && b.message.threadId).toBe(a.id);
			expect(unrelated.created && unrelated.message.threadId).toBe(unrelated.id);
			expect(unrelated.created && unrelated.clientName).toBeNull();
		});
	});

	it('sends a threaded reply once, stores it and finds the answer to it by subject', async () => {
		await inRollback(async (tx, userId) => {
			const budi = addr('budi');
			const c = await clientWithContact(tx, userId, budi);
			const first = incoming({ from: { name: 'Budi', email: budi } });
			const a = await receiveEmail(tx, first);
			const { sent, deps } = fakeSender();

			const thread = await getThread(tx, a.id!);
			const defaults = replyDefaults(thread!.messages, inbox.email);
			expect(defaults).toEqual({
				to: `Budi <${budi}>`,
				cc: '',
				subject: 'Re: Penawaran integrasi ERP'
			});

			const input = {
				threadId: a.id!,
				to: [{ name: 'Budi', email: budi }],
				cc: [],
				subject: '',
				body: 'Terima kasih, kami kirim proposal besok.',
				key: `k-${run}`
			};
			const reply = await sendEmailMessage(tx, input, userId, deps);
			const twice = await sendEmailMessage(tx, input, userId, deps);
			expect(twice.id).toBe(reply.id);
			expect(sent).toHaveLength(1);
			expect(sent[0].subject).toBe('Re: Penawaran integrasi ERP');
			expect(sent[0].headers?.['In-Reply-To']).toBe(first.messageId);
			expect(sent[0].headers?.References).toBe(first.messageId);
			expect(sent[0].text).toContain('> Halo, kami tertarik');
			// Signature between the message and the quote; the stored copy keeps the HTML
			const sig = sent[0].text.indexOf('\n--\n');
			expect(sig).toBeGreaterThan(0);
			expect(sig).toBeLessThan(sent[0].text.indexOf('> Halo'));
			expect(sent[0].text).toContain('info@befisien.com · befisien.com');
			const [stored] = await tx.select().from(emailMessage).where(eq(emailMessage.id, reply.id));
			expect(stored.html).toContain('href="mailto:info@befisien.com"');
			expect(reply.threadId).toBe(a.id);

			// A new email from the CRM: the client's reply points at a Message-ID Resend replaced
			const fresh = await sendEmailMessage(
				tx,
				{ ...input, threadId: undefined, subject: 'Jadwal demo', key: `k2-${run}` },
				userId,
				deps
			);
			expect(fresh.threadId).toBe(fresh.id);
			const answer = await receiveEmail(
				tx,
				incoming({
					from: { name: 'Budi', email: budi },
					subject: 'RE: Jadwal demo',
					inReplyTo: '<unknown@resend>'
				})
			);
			expect(answer.created && answer.message.threadId).toBe(fresh.id);

			const logged = await emailActivities(tx, c.id);
			expect(logged.map((l) => l.body?.split('\n')[0])).toEqual(
				expect.arrayContaining([
					'Email masuk: Penawaran integrasi ERP',
					'Email terkirim: Re: Penawaran integrasi ERP',
					'Email terkirim: Jadwal demo',
					'Email masuk: RE: Jadwal demo'
				])
			);
		});
	});

	it('sends files and pasted pictures, keeps the pictures and lists the files', async () => {
		await inRollback(async (tx, userId) => {
			const budi = addr('files');
			await clientWithContact(tx, userId, budi);
			const { sent, deps } = fakeSender();
			const png = 'data:image/png;base64,iVBORw0KGgo=';
			const input = {
				to: [{ name: 'Budi', email: budi }],
				cc: [],
				subject: 'Proposal dan denah',
				body: `<p onclick="x()">Berikut denahnya:</p><img src="${png}" alt="denah"><script>alert(1)</script>`,
				key: `kf-${run}`,
				files: [
					{
						filename: 'C:\\fakepath\\Proposal "Q4".pdf',
						contentType: 'application/pdf',
						data: new TextEncoder().encode('%PDF-1.4')
					}
				]
			};
			const out = await sendEmailMessage(tx, input, userId, deps);

			const mail = sent[0];
			expect(mail.html).not.toMatch(/script|onclick|data:image/);
			const cid = /src="cid:([^"]+)"/.exec(mail.html)?.[1];
			expect(mail.attachments).toEqual([
				{
					filename: 'Proposal _Q4_.pdf',
					content: Buffer.from('%PDF-1.4').toString('base64'),
					contentType: 'application/pdf'
				},
				expect.objectContaining({ contentId: cid, contentType: 'image/png' })
			]);
			expect(mail.text).toContain('Berikut denahnya:\n[gambar]');

			const [stored] = await tx.select().from(emailMessage).where(eq(emailMessage.id, out.id));
			expect(stored.html).toContain(`src="${png}"`);
			expect(stored.attachments).toEqual([
				{
					id: 'out-1',
					filename: 'Proposal _Q4_.pdf',
					contentType: 'application/pdf',
					size: 8,
					inline: false
				}
			]);
			expect(await attachmentSource(tx, out.id, 'out-1')).toMatchObject({
				direction: 'out',
				filename: 'Proposal _Q4_.pdf',
				nth: 0
			});

			await expect(
				sendEmailMessage(
					tx,
					{ ...input, key: `kf2-${run}`, files: [{ ...input.files[0], filename: 'setup.exe' }] },
					userId,
					deps
				)
			).rejects.toThrow(/file program/);
			await expect(
				sendEmailMessage(tx, { ...input, key: `kf3-${run}`, body: '<p> </p>' }, userId, deps)
			).rejects.toThrow('Tulis isi email.');
		});
	});

	it('filters threads, counts unread and marks a thread read or unread', async () => {
		await inRollback(async (tx, userId) => {
			const budi = addr('budi');
			await clientWithContact(tx, userId, budi);
			const before = await unreadThreadCount(tx);
			const known = await receiveEmail(tx, incoming({ from: { name: 'Budi', email: budi } }));
			const stranger = await receiveEmail(
				tx,
				incoming({ from: { name: null, email: addr('baru') }, subject: `Tanya harga q${run}q` })
			);
			expect(await unreadThreadCount(tx)).toBe(before + 2);

			const search = await listThreads(tx, { q: `q${run}q` });
			expect(search.rows.map((r) => r.threadId)).toEqual([stranger.id]);
			const none = await listThreads(tx, { filter: 'none', q: 'zz-test.id' });
			expect(none.rows.map((r) => r.threadId)).toContain(stranger.id);
			expect(none.rows.map((r) => r.threadId)).not.toContain(known.id);

			await markThread(tx, known.id!, true);
			expect(await unreadThreadCount(tx)).toBe(before + 1);
			await markThread(tx, known.id!, false);
			expect(await unreadThreadCount(tx)).toBe(before + 2);
		});
	});

	it('links an unmatched thread to a client and saves the sender as a contact', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: `ZZ Link ${run}` }), userId);
			const baru = addr('baru');
			const m = await receiveEmail(tx, incoming({ from: { name: 'Rina Wijaya', email: baru } }));

			await linkThread(tx, { threadId: m.id!, clientId: c.id, addContact: true }, userId);
			const [row] = await tx.select().from(emailMessage).where(eq(emailMessage.id, m.id!));
			expect(row.clientId).toBe(c.id);
			expect(row.contactId).not.toBeNull();
			const [saved] = await tx.select().from(contact).where(eq(contact.id, row.contactId!));
			expect(saved).toMatchObject({ name: 'Rina Wijaya', email: baru, clientId: c.id });
			expect(await emailActivities(tx, c.id)).toHaveLength(1);

			// The next email from Rina is matched without help
			const next = await receiveEmail(tx, incoming({ from: { name: 'Rina', email: baru } }));
			expect(next.created && next.clientName).toBe(c.name);
		});
	});

	it('forwards an email as a new conversation with its chosen attachments', async () => {
		await inRollback(async (tx, userId) => {
			const budi = addr('budi');
			const c = await clientWithContact(tx, userId, budi);
			const original = await receiveEmail(
				tx,
				incoming({
					from: { name: 'Budi', email: budi },
					html: '<html><body><p>Lihat <b>lampiran</b>.</p><script>x()</script></body></html>',
					attachments: [
						{
							id: 'a1',
							filename: 'kebutuhan.pdf',
							contentType: 'application/pdf',
							size: 4,
							inline: false
						},
						{ id: 'a2', filename: 'foto.jpg', contentType: 'image/jpeg', size: 3, inline: false }
					]
				})
			);
			const { sent, deps } = fakeSender();
			const loaded: string[] = [];
			const withFiles = {
				...deps,
				loadAttachment: async (s: { attachment: { id: string } }) => {
					loaded.push(s.attachment.id);
					return new TextEncoder().encode('%PDF');
				}
			};

			const fwd = await sendEmailMessage(
				tx,
				{
					threadId: original.id!,
					to: [{ name: 'Sari', email: addr('sari') }],
					cc: [],
					subject: '',
					// No message of its own: allowed for a forward
					body: '<p></p>',
					key: `fwd-${run}`,
					forward: { emailId: original.id!, attachmentIds: ['a1'] }
				},
				userId,
				withFiles
			);
			expect(fwd.forwarded).toBe(true);
			// A new conversation, not a reply in Budi's thread
			expect(fwd.threadId).toBe(fwd.id);
			expect(sent).toHaveLength(1);
			expect(sent[0].subject).toBe('Fwd: Penawaran integrasi ERP');
			expect(sent[0].headers?.['In-Reply-To']).toBeUndefined();
			expect(sent[0].text).toContain('---------- Pesan yang diteruskan ----------');
			expect(sent[0].text).toContain(`Dari: Budi <${budi}>`);
			expect(sent[0].html).toContain('<p>Lihat <b>lampiran</b>.</p>');
			expect(sent[0].html).not.toContain('<script');
			// Only the ticked attachment, fetched again from Resend
			expect(loaded).toEqual(['a1']);
			expect(sent[0].attachments?.map((a) => a.filename)).toEqual(['kebutuhan.pdf']);

			const [stored] = await tx.select().from(emailMessage).where(eq(emailMessage.id, fwd.id));
			expect(stored.clientId).toBe(c.id);
			expect(stored.attachments.map((a) => a.filename)).toEqual(['kebutuhan.pdf']);
			const logged = await emailActivities(tx, c.id);
			expect(logged.map((l) => l.body?.split('\n')[0])).toContain(
				'Email diteruskan: Fwd: Penawaran integrasi ERP'
			);
		});
	});

	it('refuses to forward attachments Resend no longer keeps, but forwards without them', async () => {
		await inRollback(async (tx, userId) => {
			const old = await receiveEmail(
				tx,
				incoming({
					from: { name: null, email: addr('lama') },
					sentAt: new Date(Date.now() - 40 * 24 * 3600_000),
					attachments: [
						{
							id: 'a1',
							filename: 'lama.pdf',
							contentType: 'application/pdf',
							size: 4,
							inline: false
						}
					]
				})
			);
			const { sent, deps } = fakeSender();
			const input = {
				to: [{ name: null, email: addr('sari') }],
				cc: [],
				subject: '',
				body: '<p>Untuk diketahui.</p>',
				key: `old-${run}`,
				forward: { emailId: old.id!, attachmentIds: ['a1'] }
			};
			await expect(sendEmailMessage(tx, input, userId, deps)).rejects.toMatchObject({
				field: 'forwardFiles'
			});
			expect(sent).toHaveLength(0);
			const ok = await sendEmailMessage(
				tx,
				{ ...input, forward: { emailId: old.id!, attachmentIds: [] } },
				userId,
				deps
			);
			expect(ok.forwarded).toBe(true);
			expect(sent[0].text).toContain('Untuk diketahui.');
		});
	});
});
