// Database tests for email drafts, scheduled sending and Sampah (P3-09). Neon `dev` branch (or
// localhost) only, inside a transaction that is always rolled back; Resend, the bucket and
// Trigger.dev are fakes.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { emailDraft, emailFile, emailMessage, user } from '../db/schema/index';
import type { OutgoingMail } from '../notify/email';
import type { FileStorage } from '../storage/files';
import {
	deleteThreadForever,
	getThread,
	listThreads,
	purgeTrash,
	receiveEmail,
	restoreThread,
	threadCounts,
	trashThread,
	unreadThreadCount,
	type IncomingEmail
} from './email';
import {
	deleteDraft,
	draftCounts,
	dropSentDraft,
	getDraft,
	listDrafts,
	saveDraft,
	scheduleDraft,
	sendDraftNow,
	sendScheduledDraft,
	threadDrafts,
	unscheduleDraft,
	type DraftInput
} from './email-drafts';
import { cleanupEmailFiles, createUpload } from './email-files';
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
function incoming(fields: Partial<IncomingEmail> = {}): IncomingEmail {
	seq += 1;
	return {
		resendId: `zz-d-${run}-${seq}`,
		messageId: `<d${seq}.${run}@mail.zz-test.id>`,
		inReplyTo: null,
		references: [],
		from: { name: 'Budi', email: addr('budi') },
		to: ['info@befisien.com'],
		cc: [],
		replyTo: null,
		subject: `Penawaran ${run}`,
		text: 'Halo, kami tertarik.',
		html: null,
		attachments: [],
		bulk: false,
		sentAt: new Date(Date.now() - (100 - seq) * 60_000),
		...fields
	};
}

function fakes() {
	const objects = new Map<string, Uint8Array>();
	const storage: FileStorage = {
		uploadUrl: async (key) => `https://bucket.test/${key}`,
		size: async (key) => objects.get(key)?.byteLength ?? null,
		read: async (key) => objects.get(key)!,
		downloadUrl: async (key) => `https://bucket.test/${key}`,
		remove: async (keys) => keys.forEach((k) => objects.delete(k))
	};
	const sent: OutgoingMail[] = [];
	const ids = new Map<string, string>();
	const queued: { draftId: string; at: Date; runId: string }[] = [];
	const cancelled: string[] = [];
	return {
		objects,
		sent,
		queued,
		cancelled,
		send: {
			from: { name: 'Befisien', email: 'info@befisien.com' },
			brand: {
				logoUrl: null,
				name: 'Befisien',
				wordmark: 'BEFISIEN',
				tagline: 'Tagline uji',
				services: [],
				links: []
			},
			storage,
			appUrl: 'https://crm.test',
			// Same idempotency key → same Resend id, like the real API
			send: async (mail: OutgoingMail) => {
				const key = mail.idempotencyKey ?? String(sent.length);
				if (!ids.has(key)) {
					sent.push(mail);
					ids.set(key, `zz-d-out-${run}-${ids.size + 1}`);
				}
				return ids.get(key)!;
			},
			cancel: async (runId: string) => {
				cancelled.push(runId);
			}
		},
		schedule: {
			queue: async (draftId: string, at: Date) => {
				const runId = `run_${queued.length + 1}`;
				queued.push({ draftId, at, runId });
				return runId;
			},
			cancel: async (runId: string) => {
				cancelled.push(runId);
			}
		}
	};
}

function draft(fields: Partial<DraftInput> = {}): DraftInput {
	return {
		id: crypto.randomUUID(),
		to: addr('ani'),
		cc: '',
		subject: `Proposal ${run}`,
		body: '<p>Terlampir proposal kami.</p>',
		uploads: [],
		forwardFiles: [],
		...fields
	};
}

const inMinutes = (n: number) => new Date(Date.now() + n * 60_000);

describe.skipIf(!isDevDb)('email drafts and Sampah (dev database)', { timeout: 30_000 }, () => {
	it('saves a draft once per email, only for its writer, and deletes it when emptied', async () => {
		await inRollback(async (tx, userId) => {
			const d = draft();
			const first = await saveDraft(tx, userId, d);
			expect(first.id).toBe(d.id);
			await saveDraft(tx, userId, { ...d, subject: 'Proposal (revisi)' });
			const rows = await tx.select().from(emailDraft).where(eq(emailDraft.id, d.id));
			expect(rows).toHaveLength(1);
			expect(rows[0].subject).toBe('Proposal (revisi)');
			expect(rows[0].snippet).toBe('Terlampir proposal kami.');
			expect((await draftCounts(tx, userId)).drafts).toBeGreaterThanOrEqual(1);
			expect((await listDrafts(tx, userId, 'drafts')).some((r) => r.id === d.id)).toBe(true);

			// Another user cannot overwrite or read it
			await expect(saveDraft(tx, 'someone-else', { ...d, subject: 'x' })).rejects.toThrow(
				ServiceError
			);
			expect(await getDraft(tx, 'someone-else', d.id)).toBeNull();

			const emptied = await saveDraft(tx, userId, { ...d, to: '', subject: '', body: '' });
			expect(emptied.id).toBeNull();
			expect(await getDraft(tx, userId, d.id)).toBeNull();
		});
	});

	it('keeps a draft’s uploads through the nightly cleanup and lets go of removed ones', async () => {
		await inRollback(async (tx, userId) => {
			const f = fakes();
			const a = await createUpload(
				tx,
				f.send.storage,
				{ filename: 'proposal.pdf', size: 10, contentType: 'application/pdf' },
				userId
			);
			const b = await createUpload(
				tx,
				f.send.storage,
				{ filename: 'harga.xlsx', size: 10, contentType: '' },
				userId
			);
			const d = draft({ uploads: [a.fileId, b.fileId] });
			await saveDraft(tx, userId, d);
			expect((await getDraft(tx, userId, d.id))?.uploads.map((u) => u.filename)).toEqual([
				'proposal.pdf',
				'harga.xlsx'
			]);
			await saveDraft(tx, userId, { ...d, uploads: [a.fileId] });

			const twoDaysLater = new Date(Date.now() + 48 * 3600_000);
			await cleanupEmailFiles(tx, f.send.storage, twoDaysLater);
			const [kept] = await tx.select().from(emailFile).where(eq(emailFile.id, a.fileId));
			const [dropped] = await tx.select().from(emailFile).where(eq(emailFile.id, b.fileId));
			expect(kept.status).toBe('uploading');
			expect(dropped.status).toBe('deleted');
		});
	});

	it('schedules, sends once at the time with the draft’s files, and ignores a stale run', async () => {
		await inRollback(async (tx, userId) => {
			const f = fakes();
			const up = await createUpload(
				tx,
				f.send.storage,
				{ filename: 'proposal.pdf', size: 12, contentType: 'application/pdf' },
				userId
			);
			const [row] = await tx.select().from(emailFile).where(eq(emailFile.id, up.fileId));
			f.objects.set(row.key, new TextEncoder().encode('isi proposal'));
			const d = draft({ uploads: [up.fileId] });
			const at = inMinutes(30);
			await scheduleDraft(tx, userId, d, at, f.schedule);
			expect(f.queued).toEqual([{ draftId: d.id, at, runId: 'run_1' }]);
			expect((await listDrafts(tx, userId, 'scheduled')).find((r) => r.id === d.id)?.status).toBe(
				'scheduled'
			);
			// Cannot be edited while scheduled
			await expect(saveDraft(tx, userId, { ...d, subject: 'x' })).rejects.toThrow(ServiceError);

			// Too early: nothing happens
			expect((await sendScheduledDraft(tx, d.id, f.send)).status).toBe('skipped');
			expect(f.sent).toHaveLength(0);

			const result = await sendScheduledDraft(tx, d.id, f.send, inMinutes(30));
			expect(result.status).toBe('sent');
			expect(f.sent).toHaveLength(1);
			expect(f.sent[0].to).toEqual([d.to]);
			expect(f.sent[0].attachments?.map((x) => x.filename)).toEqual(['proposal.pdf']);
			expect(await getDraft(tx, userId, d.id)).toBeNull();
			const [file] = await tx.select().from(emailFile).where(eq(emailFile.id, up.fileId));
			expect(file.status).toBe('sent');
			const [stored] = await tx
				.select()
				.from(emailMessage)
				.where(eq(emailMessage.id, file.emailId!));
			expect(stored.subject).toBe(d.subject);

			// The same run again (a retry) sends nothing
			expect((await sendScheduledDraft(tx, d.id, f.send, inMinutes(31))).status).toBe('skipped');
			expect(f.sent).toHaveLength(1);
		});
	});

	it('refuses an unready email, and moves a cancelled schedule back to Draf', async () => {
		await inRollback(async (tx, userId) => {
			const f = fakes();
			await expect(
				scheduleDraft(tx, userId, draft({ to: 'bukan alamat' }), inMinutes(30), f.schedule)
			).rejects.toThrow('Alamat tidak valid');
			await expect(scheduleDraft(tx, userId, draft(), inMinutes(0), f.schedule)).rejects.toThrow(
				ServiceError
			);

			const d = draft();
			await scheduleDraft(tx, userId, d, inMinutes(60), f.schedule);
			await unscheduleDraft(tx, userId, d.id, f.schedule);
			expect(f.cancelled).toEqual(['run_1']);
			const back = await getDraft(tx, userId, d.id);
			expect(back?.status).toBe('draft');
			// The old run wakes up and finds nothing to send
			expect((await sendScheduledDraft(tx, d.id, f.send, inMinutes(60))).status).toBe('skipped');

			// Schedule again, then throw it away: its run is cancelled too
			await scheduleDraft(tx, userId, d, inMinutes(90), f.schedule);
			await deleteDraft(tx, userId, d.id, f.schedule);
			expect(f.cancelled).toEqual(['run_1', 'run_2']);
		});
	});

	it('marks a scheduled email Gagal when sending is refused, and Kirim sekarang sends it', async () => {
		await inRollback(async (tx, userId) => {
			const f = fakes();
			const d = draft();
			await scheduleDraft(tx, userId, d, inMinutes(10), f.schedule);
			// The address became invalid in between (only possible by hand; stands for any refusal)
			await tx.update(emailDraft).set({ to: 'rusak@' }).where(eq(emailDraft.id, d.id));
			const result = await sendScheduledDraft(tx, d.id, f.send, inMinutes(10));
			expect(result.status).toBe('failed');
			const failed = await getDraft(tx, userId, d.id);
			expect(failed?.status).toBe('failed');
			expect(failed?.error).toContain('Alamat tidak valid');

			await tx
				.update(emailDraft)
				.set({ to: addr('ani') })
				.where(eq(emailDraft.id, d.id));
			await sendDraftNow(tx, userId, d.id, f.send);
			expect(f.sent).toHaveLength(1);
			expect(await getDraft(tx, userId, d.id)).toBeNull();
		});
	});

	it('keeps reply drafts with their thread and drops the draft once it is sent', async () => {
		await inRollback(async (tx, userId) => {
			const got = await receiveEmail(tx, incoming());
			if (!got.created) throw new Error('not stored');
			const reply = draft({ threadId: got.id, subject: '', body: '<p>Siap, kami kirim.</p>' });
			await saveDraft(tx, userId, reply);
			expect((await threadDrafts(tx, userId, got.id)).map((x) => x.id)).toEqual([reply.id]);
			await dropSentDraft(tx, userId, reply.id);
			expect(await threadDrafts(tx, userId, got.id)).toEqual([]);
		});
	});

	it('moves a thread to Sampah, out of the lists and the badge, and back', async () => {
		await inRollback(async (tx, userId) => {
			const got = await receiveEmail(tx, incoming());
			if (!got.created) throw new Error('not stored');
			const before = await unreadThreadCount(tx);
			const q = run;

			await trashThread(tx, got.id, userId);
			expect(await unreadThreadCount(tx)).toBe(before - 1);
			expect((await listThreads(tx, { q })).rows).toHaveLength(0);
			const trash = await listThreads(tx, { filter: 'trash', q });
			expect(trash.rows.map((r) => r.threadId)).toEqual([got.id]);
			expect(trash.rows[0].deletedAt).toBeInstanceOf(Date);
			expect((await threadCounts(tx, q)).trash).toBe(1);
			expect((await getThread(tx, got.id))?.deletedAt).toBeInstanceOf(Date);
			await expect(trashThread(tx, got.id, userId)).rejects.toThrow(ServiceError);

			await restoreThread(tx, got.id);
			expect((await listThreads(tx, { q })).rows).toHaveLength(1);
			expect((await threadCounts(tx, q)).trash).toBe(0);
		});
	});

	it('brings a thread back when a reply arrives, and deletes it for good only from Sampah', async () => {
		await inRollback(async (tx, userId) => {
			const first = incoming();
			const got = await receiveEmail(tx, first);
			if (!got.created) throw new Error('not stored');
			await trashThread(tx, got.id, userId);
			await receiveEmail(
				tx,
				incoming({ inReplyTo: first.messageId, references: [first.messageId!] })
			);
			const thread = await getThread(tx, got.id);
			expect(thread?.messages).toHaveLength(2);
			expect(thread?.deletedAt).toBeNull();

			await expect(deleteThreadForever(tx, got.id)).rejects.toThrow(ServiceError);
			await trashThread(tx, got.id, userId);
			await deleteThreadForever(tx, got.id);
			expect(await getThread(tx, got.id)).toBeNull();
		});
	});

	it('purges only what has been in Sampah for 30 days', async () => {
		await inRollback(async (tx, userId) => {
			const old = await receiveEmail(tx, incoming({ subject: `Lama ${run}` }));
			const fresh = await receiveEmail(tx, incoming({ subject: `Baru ${run}` }));
			if (!old.created || !fresh.created) throw new Error('not stored');
			await trashThread(tx, old.id, userId);
			await trashThread(tx, fresh.id, userId);
			await tx
				.update(emailMessage)
				.set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
				.where(eq(emailMessage.threadId, old.id));

			await purgeTrash(tx);
			expect(await getThread(tx, old.id)).toBeNull();
			expect(await getThread(tx, fresh.id)).not.toBeNull();
			await purgeTrash(tx, { all: true });
			expect(await getThread(tx, fresh.id)).toBeNull();
		});
	});
});
