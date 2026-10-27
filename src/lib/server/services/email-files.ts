// Big files in emails (P3-08): uploads straight to the Neon bucket, the download links, cleanup.
// Relative imports only: services are shared with Trigger.dev tasks.
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { EMAIL_MAX_FILES, fileSize, isBlockedFile } from '../../email';
import { EMAIL_FILE_MAX } from '../../email-files';
import type { DbOrTx } from '../db/client';
import { emailFile } from '../db/schema/index';
import type { FileStorage } from '../storage/files';
import { ServiceError } from './errors';

export type EmailFileRow = typeof emailFile.$inferSelect;

/** "Laporan Q3.pdf" as a safe name: no path, quotes or line breaks */
export const safeFileName = (raw: string) =>
	raw
		.split(/[\\/]/)
		.pop()!
		.replace(/[\r\n"<>]+/g, '_')
		.trim()
		.slice(-200) || 'lampiran';

/** An unguessable code for /f/<token> (32 characters) */
export const newFileToken = () => randomBytes(24).toString('base64url');

/** An upload the browser does itself: a row, and a presigned PUT (valid an hour) */
export async function createUpload(
	db: DbOrTx,
	storage: FileStorage,
	input: { filename: string; size: number; contentType: string },
	userId: string
) {
	const filename = safeFileName(input.filename);
	if (isBlockedFile(filename))
		throw new ServiceError(`${filename} tidak bisa dikirim: file program ditolak layanan email.`);
	if (!Number.isInteger(input.size) || input.size <= 0)
		throw new ServiceError(`${filename} kosong.`);
	if (input.size > EMAIL_FILE_MAX)
		throw new ServiceError(
			`${filename} ${fileSize(input.size)}, maksimal ${fileSize(EMAIL_FILE_MAX)} per file.`
		);
	const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(input.contentType)
		? input.contentType
		: 'application/octet-stream';
	const id = randomUUID();
	const key = `email/${id}/${filename}`;
	await db.insert(emailFile).values({
		id,
		key,
		filename,
		contentType,
		size: input.size,
		createdBy: userId
	});
	return { fileId: id, url: await storage.uploadUrl(key, contentType), contentType };
}

/**
 * The uploads an email is about to carry, checked against the bucket: each must be there and no
 * bigger than allowed (the browser's size is not trusted). Their order is kept.
 */
export async function uploadedFiles(db: DbOrTx, storage: FileStorage, ids: string[]) {
	if (!ids.length) return [];
	if (ids.length > EMAIL_MAX_FILES)
		throw new ServiceError(`Maksimal ${EMAIL_MAX_FILES} lampiran per email.`, 'files');
	const rows = await db.select().from(emailFile).where(inArray(emailFile.id, ids));
	const byId = new Map(rows.map((r) => [r.id, r]));
	const files: EmailFileRow[] = [];
	for (const id of ids) {
		const row = byId.get(id);
		if (!row || row.status !== 'uploading')
			throw new ServiceError('Lampiran tidak ditemukan. Lampirkan file lagi.', 'files');
		const size = await storage.size(row.key);
		if (size === null)
			throw new ServiceError(
				`${row.filename} belum selesai diunggah. Tunggu sampai selesai atau lampirkan lagi.`,
				'files'
			);
		if (size > EMAIL_FILE_MAX)
			throw new ServiceError(
				`${row.filename} ${fileSize(size)}, maksimal ${fileSize(EMAIL_FILE_MAX)} per file.`,
				'files'
			);
		if (size !== row.size) await db.update(emailFile).set({ size }).where(eq(emailFile.id, id));
		files.push({ ...row, size });
	}
	return files;
}

/** A download link's file while it still works (not deleted, not past expires_at) */
export async function fileByToken(db: DbOrTx, token: string, now = new Date()) {
	const [row] = await db.select().from(emailFile).where(eq(emailFile.token, token));
	if (!row || row.status === 'deleted') return { file: null, expired: false };
	if (!row.expiresAt || row.expiresAt <= now) return { file: null, expired: true };
	return { file: row, expired: false };
}

/** A stored email's uploaded file, for "Unduh" in the thread */
export async function fileForDownload(db: DbOrTx, fileId: string, now = new Date()) {
	const [row] = await db.select().from(emailFile).where(eq(emailFile.id, fileId));
	if (!row || row.status === 'deleted' || (row.expiresAt && row.expiresAt <= now)) return null;
	return row;
}

/** Unsent uploads are deleted after this */
const UNSENT_HOURS = 24;

/**
 * Daily: delete the objects of files past expires_at, and of uploads never sent (a day old, no
 * link handed out, not on a saved draft). The rows stay as "deleted" so the thread can say the file expired.
 */
export async function cleanupEmailFiles(db: DbOrTx, storage: FileStorage, now = new Date()) {
	const unsentBefore = new Date(now.getTime() - UNSENT_HOURS * 3600_000);
	const rows = await db
		.select({ id: emailFile.id, key: emailFile.key })
		.from(emailFile)
		.where(
			and(
				ne(emailFile.status, 'deleted'),
				or(
					and(isNotNull(emailFile.expiresAt), lt(emailFile.expiresAt, now)),
					and(
						eq(emailFile.status, 'uploading'),
						isNull(emailFile.token),
						// Kept while a saved draft (P3-09) holds them
						isNull(emailFile.draftId),
						lt(emailFile.createdAt, unsentBefore)
					)
				)
			)
		);
	if (!rows.length) return { deleted: 0 };
	await storage.remove(rows.map((r) => r.key));
	await db
		.update(emailFile)
		.set({ status: 'deleted' })
		.where(
			inArray(
				emailFile.id,
				rows.map((r) => r.id)
			)
		);
	return { deleted: rows.length };
}
