// Database tests for big files in emails (P3-08). Neon `dev` branch (or localhost) only, inside a
// transaction that is always rolled back; the bucket is an in-memory fake.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { emailFile, emailMessage, user } from '../db/schema/index';
import type { OutgoingMail } from '../notify/email';
import type { FileStorage } from '../storage/files';
import { sendEmailMessage } from './email';
import { cleanupEmailFiles, createUpload, fileByToken } from './email-files';
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

const MB = 1024 * 1024;

/** An in-memory bucket; `size` can claim a big file without holding its bytes */
function fakeStorage() {
	const objects = new Map<string, { size: number; data: Uint8Array }>();
	const storage: FileStorage = {
		uploadUrl: async (key) => `https://bucket.test/${encodeURIComponent(key)}?signed`,
		size: async (key) => objects.get(key)?.size ?? null,
		read: async (key) => objects.get(key)!.data,
		downloadUrl: async (key, filename) => `https://bucket.test/${key}?as=${filename}`,
		remove: async (keys) => keys.forEach((k) => objects.delete(k))
	};
	return {
		storage,
		objects,
		/** What the browser's PUT does */
		put: (key: string, size: number) =>
			objects.set(key, { size, data: new TextEncoder().encode(`isi ${key}`) })
	};
}

function deps(storage: FileStorage) {
	const sent: OutgoingMail[] = [];
	return {
		sent,
		deps: {
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
			send: async (mail: OutgoingMail) => {
				sent.push(mail);
				return `zz-files-${Math.random().toString(36).slice(2)}`;
			}
		}
	};
}

const run = Math.random().toString(36).slice(2, 8);

describe.skipIf(!isDevDb)('email big files (dev database)', { timeout: 30_000 }, () => {
	it('refuses program files and files above 200 MB before anything is uploaded', async () => {
		await inRollback(async (tx, userId) => {
			const { storage } = fakeStorage();
			await expect(
				createUpload(tx, storage, { filename: 'setup.exe', size: 10, contentType: '' }, userId)
			).rejects.toBeInstanceOf(ServiceError);
			await expect(
				createUpload(
					tx,
					storage,
					{ filename: 'video.mp4', size: 201 * MB, contentType: 'video/mp4' },
					userId
				)
			).rejects.toThrow(/maksimal 200,0 MB/);
			const ok = await createUpload(
				tx,
				storage,
				{ filename: '../../Proposal "Q3".pdf', size: 5, contentType: 'application/pdf' },
				userId
			);
			const [row] = await tx.select().from(emailFile).where(eq(emailFile.id, ok.fileId));
			expect(row).toMatchObject({ filename: 'Proposal _Q3_.pdf', status: 'uploading' });
			expect(ok.url).toContain('signed');
		});
	});

	it('attaches what fits in 25 MB, sends the rest as working links, and records both', async () => {
		await inRollback(async (tx, userId) => {
			const { storage, put } = fakeStorage();
			const small = await createUpload(
				tx,
				storage,
				{ filename: 'harga.pdf', size: 2 * MB, contentType: 'application/pdf' },
				userId
			);
			const big = await createUpload(
				tx,
				storage,
				{ filename: 'demo.mp4', size: 180 * MB, contentType: 'video/mp4' },
				userId
			);
			const [s, b] = await tx
				.select()
				.from(emailFile)
				.where(eq(emailFile.createdBy, userId))
				.then((rows) => [
					rows.find((r) => r.id === small.fileId)!,
					rows.find((r) => r.id === big.fileId)!
				]);
			put(s.key, 2 * MB);
			put(b.key, 180 * MB);

			const { sent, deps: d } = deps(storage);
			const email = await sendEmailMessage(
				tx,
				{
					to: [{ name: null, email: `budi.${run}@zz-test.id` }],
					cc: [],
					subject: 'Proposal dan demo',
					body: '<p>Terlampir.</p>',
					key: `files-${run}`,
					uploads: [small.fileId, big.fileId]
				},
				userId,
				d
			);

			// Only the small file goes as an attachment; the big one as a link in the message
			expect(sent[0].attachments?.map((a) => a.filename)).toEqual(['harga.pdf']);
			const [linkRow] = await tx.select().from(emailFile).where(eq(emailFile.id, big.fileId));
			expect(linkRow.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
			expect(sent[0].html).toContain(`https://crm.test/f/${linkRow.token}`);
			expect(sent[0].text).toContain(`demo.mp4 (180,0 MB): https://crm.test/f/${linkRow.token}`);

			const [stored] = await tx.select().from(emailMessage).where(eq(emailMessage.id, email.id));
			expect(stored.attachments.map((a) => [a.filename, !!a.link, !!a.fileId])).toEqual([
				['harga.pdf', false, true],
				['demo.mp4', true, true]
			]);
			const rows = await tx.select().from(emailFile).where(eq(emailFile.emailId, email.id));
			expect(rows.map((r) => r.status)).toEqual(['sent', 'sent']);
			expect(rows.every((r) => r.expiresAt)).toBe(true);

			// The link works until it expires
			expect((await fileByToken(tx, linkRow.token!)).file?.id).toBe(big.fileId);
			const later = new Date(linkRow.expiresAt!.getTime() + 1000);
			expect(await fileByToken(tx, linkRow.token!, later)).toEqual({ file: null, expired: true });
		});
	});

	it('refuses an email whose file never reached the bucket', async () => {
		await inRollback(async (tx, userId) => {
			const { storage } = fakeStorage();
			const up = await createUpload(
				tx,
				storage,
				{ filename: 'belum.pdf', size: 10, contentType: 'application/pdf' },
				userId
			);
			const { sent, deps: d } = deps(storage);
			await expect(
				sendEmailMessage(
					tx,
					{
						to: [{ name: null, email: `budi.${run}@zz-test.id` }],
						cc: [],
						subject: 'Uji',
						body: '<p>Halo</p>',
						key: `missing-${run}`,
						uploads: [up.fileId]
					},
					userId,
					d
				)
			).rejects.toThrow(/belum selesai diunggah/);
			expect(sent).toHaveLength(0);
		});
	});

	it('cleans up expired files and day-old uploads that were never sent', async () => {
		await inRollback(async (tx, userId) => {
			const { storage, put, objects } = fakeStorage();
			const keep = await createUpload(
				tx,
				storage,
				{ filename: 'baru.pdf', size: 10, contentType: 'application/pdf' },
				userId
			);
			const unsent = await createUpload(
				tx,
				storage,
				{ filename: 'lupa.pdf', size: 10, contentType: 'application/pdf' },
				userId
			);
			const rows = await tx.select().from(emailFile).where(eq(emailFile.createdBy, userId));
			for (const r of rows) put(r.key, 10);
			const unsentRow = rows.find((r) => r.id === unsent.fileId)!;
			await tx
				.update(emailFile)
				.set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
				.where(eq(emailFile.id, unsent.fileId));

			const result = await cleanupEmailFiles(tx, storage);
			expect(result.deleted).toBeGreaterThanOrEqual(1);
			expect(objects.has(unsentRow.key)).toBe(false);
			const [kept] = await tx.select().from(emailFile).where(eq(emailFile.id, keep.fileId));
			expect(kept.status).toBe('uploading');
			const [gone] = await tx.select().from(emailFile).where(eq(emailFile.id, unsent.fileId));
			expect(gone.status).toBe('deleted');
		});
	});
});
