// Email drafts and scheduled sending (P3-09). The drawer saves what is being written; Jadwalkan
// queues a delayed Trigger.dev run (email-scheduled-send) that sends it through sendEmailMessage.
// Only the writer sees a draft. Relative imports only: shared with Trigger.dev tasks.
import { and, asc, desc, eq, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
import { htmlToText, parseAddressList, snippetOf } from '../../email';
import { draftIsEmpty, SCHEDULE_MIN_MINUTES, type DraftContent } from '../../email-draft';
import type { DbOrTx } from '../db/client';
import { emailDraft, emailFile, emailMessage, user } from '../db/schema/index';
import { escapeHtml } from '../notify/telegram';
import { sendEmailMessage, type SendDeps } from './email';
import { ServiceError } from './errors';

export type DraftInput = DraftContent & {
	/** Made by the drawer when it opens */
	id: string;
	/** Attachment ids of the forwarded email ticked to go along */
	forwardFiles: string[];
};

/** Queues and cancels the delayed send (Trigger.dev in the app, a fake in tests) */
export type ScheduleDeps = {
	queue: (draftId: string, at: Date) => Promise<string>;
	cancel: (runId: string) => Promise<void>;
};

type DraftRow = typeof emailDraft.$inferSelect;

const EDITABLE = ['draft', 'failed'] as const;
const WAITING = ['scheduled', 'sending', 'failed'] as const;

async function messageExists(db: DbOrTx, id: string) {
	const [m] = await db
		.select({ id: emailMessage.id })
		.from(emailMessage)
		.where(eq(emailMessage.id, id));
	return !!m;
}

/** The uploads on the draft are exactly `uploads` (the writer's own, not sent yet) */
async function attachFiles(db: DbOrTx, userId: string, draftId: string, uploads: string[]) {
	await db
		.update(emailFile)
		.set({ draftId: null })
		.where(
			and(
				eq(emailFile.draftId, draftId),
				uploads.length ? notInArray(emailFile.id, uploads) : undefined
			)
		);
	if (uploads.length)
		await db
			.update(emailFile)
			.set({ draftId })
			.where(
				and(
					inArray(emailFile.id, uploads),
					eq(emailFile.status, 'uploading'),
					eq(emailFile.createdBy, userId)
				)
			);
}

/**
 * Save what the drawer holds (every save of the same email updates one row). Nothing written any
 * more = the draft is deleted, `id: null`. A scheduled email must be taken off the schedule first.
 */
export async function saveDraft(db: DbOrTx, userId: string, input: DraftInput, now = new Date()) {
	if (draftIsEmpty(input)) {
		await db
			.delete(emailDraft)
			.where(
				and(
					eq(emailDraft.id, input.id),
					eq(emailDraft.userId, userId),
					inArray(emailDraft.status, EDITABLE)
				)
			);
		return { id: null, savedAt: now };
	}
	if (input.threadId && !(await messageExists(db, input.threadId)))
		throw new ServiceError('Percakapan email tidak ditemukan.');
	if (input.forwardId && !(await messageExists(db, input.forwardId)))
		throw new ServiceError('Email yang diteruskan tidak ditemukan.');

	return db.transaction(async (tx) => {
		const values = {
			threadId: input.threadId || null,
			forwardEmailId: input.forwardId || null,
			forwardFiles: input.forwardId ? input.forwardFiles : [],
			to: input.to.trim(),
			cc: input.cc.trim(),
			subject: input.subject.trim(),
			body: input.body,
			snippet: snippetOf(htmlToText(input.body)),
			status: 'draft' as const,
			error: null,
			updatedAt: now
		};
		const [row] = await tx
			.insert(emailDraft)
			.values({ id: input.id, userId, ...values })
			.onConflictDoUpdate({
				target: emailDraft.id,
				set: values,
				setWhere: and(eq(emailDraft.userId, userId), inArray(emailDraft.status, EDITABLE))
			})
			.returning({ id: emailDraft.id });
		if (!row)
			throw new ServiceError(
				'Email ini sudah dijadwalkan atau sedang dikirim. Batalkan jadwalnya untuk mengubah.'
			);
		await attachFiles(tx, userId, input.id, input.uploads);
		return { id: input.id, savedAt: now };
	});
}

/** Buang draf, or remove a scheduled email (its run is cancelled) */
export async function deleteDraft(
	db: DbOrTx,
	userId: string,
	id: string,
	deps?: Pick<ScheduleDeps, 'cancel'>
) {
	const [row] = await db
		.delete(emailDraft)
		.where(
			and(eq(emailDraft.id, id), eq(emailDraft.userId, userId), ne(emailDraft.status, 'sending'))
		)
		.returning({ runId: emailDraft.runId });
	if (!row) throw new ServiceError('Draf tidak ditemukan atau sedang dikirim.');
	if (row.runId) await cancelQuietly(deps, row.runId);
}

/** After Kirim from the drawer: the draft it came from is done (none is fine) */
export async function dropSentDraft(db: DbOrTx, userId: string, id: string) {
	await db
		.delete(emailDraft)
		.where(
			and(
				eq(emailDraft.id, id),
				eq(emailDraft.userId, userId),
				inArray(emailDraft.status, EDITABLE)
			)
		);
}

/** A stale run checks the row before sending, so a failed cancel only costs a wasted wake-up */
async function cancelQuietly(deps: Pick<ScheduleDeps, 'cancel'> | undefined, runId: string) {
	await deps?.cancel(runId).catch((e) => console.error('[email] cancel run failed:', String(e)));
}

/** Draf (newest first) or Terjadwal (soonest first; failed ones included) of one writer */
export async function listDrafts(db: DbOrTx, userId: string, view: 'drafts' | 'scheduled') {
	const rows = await db
		.select({
			id: emailDraft.id,
			threadId: emailDraft.threadId,
			forwardEmailId: emailDraft.forwardEmailId,
			to: emailDraft.to,
			subject: emailDraft.subject,
			snippet: emailDraft.snippet,
			status: emailDraft.status,
			scheduledAt: emailDraft.scheduledAt,
			error: emailDraft.error,
			updatedAt: emailDraft.updatedAt,
			files: sql<number>`(select count(*)::int from "email_file" f where f."draft_id" = "email_draft"."id" and f."status" = 'uploading')`
		})
		.from(emailDraft)
		.where(
			and(
				eq(emailDraft.userId, userId),
				view === 'drafts' ? eq(emailDraft.status, 'draft') : inArray(emailDraft.status, WAITING)
			)
		)
		.orderBy(
			...(view === 'drafts'
				? [desc(emailDraft.updatedAt)]
				: [asc(emailDraft.scheduledAt), desc(emailDraft.updatedAt)])
		)
		.limit(100);
	return rows;
}

export type DraftListRow = Awaited<ReturnType<typeof listDrafts>>[number];

/** Counts for the Draf and Terjadwal chips */
export async function draftCounts(db: DbOrTx, userId: string) {
	const [r] = await db
		.select({
			drafts: sql<number>`(count(*) filter (where ${emailDraft.status} = 'draft'))::int`,
			scheduled: sql<number>`(count(*) filter (where ${emailDraft.status} <> 'draft'))::int`
		})
		.from(emailDraft)
		.where(eq(emailDraft.userId, userId));
	return { drafts: r?.drafts ?? 0, scheduled: r?.scheduled ?? 0 };
}

/** Everything the drawer needs to carry on writing: the uploads and the email being forwarded */
async function draftDetail(db: DbOrTx, row: DraftRow) {
	const [uploads, forward] = await Promise.all([
		db
			.select({ fileId: emailFile.id, filename: emailFile.filename, size: emailFile.size })
			.from(emailFile)
			.where(and(eq(emailFile.draftId, row.id), eq(emailFile.status, 'uploading')))
			.orderBy(asc(emailFile.createdAt)),
		row.forwardEmailId
			? db
					.select({
						id: emailMessage.id,
						subject: emailMessage.subject,
						fromName: emailMessage.fromName,
						fromEmail: emailMessage.fromEmail,
						sentAt: emailMessage.sentAt,
						attachments: emailMessage.attachments
					})
					.from(emailMessage)
					.where(eq(emailMessage.id, row.forwardEmailId))
					.then((r) => r[0] ?? null)
			: null
	]);
	return {
		id: row.id,
		threadId: row.threadId,
		to: row.to,
		cc: row.cc,
		subject: row.subject,
		body: row.body,
		status: row.status,
		scheduledAt: row.scheduledAt,
		error: row.error,
		updatedAt: row.updatedAt,
		forwardFiles: row.forwardFiles,
		uploads,
		forward
	};
}

export type DraftDetail = Awaited<ReturnType<typeof draftDetail>>;

/** One draft of this writer, ready for the drawer; null when it is not theirs or gone */
export async function getDraft(db: DbOrTx, userId: string, id: string) {
	const [row] = await db
		.select()
		.from(emailDraft)
		.where(and(eq(emailDraft.id, id), eq(emailDraft.userId, userId)));
	return row ? draftDetail(db, row) : null;
}

/** The writer's replies to this thread that are not sent yet (drafts and scheduled) */
export async function threadDrafts(db: DbOrTx, userId: string, threadId: string) {
	const rows = await db
		.select()
		.from(emailDraft)
		.where(and(eq(emailDraft.threadId, threadId), eq(emailDraft.userId, userId)))
		.orderBy(desc(emailDraft.updatedAt));
	return Promise.all(rows.map((r) => draftDetail(db, r)));
}

/** What sending would refuse, checked when the email is scheduled rather than at the send time */
function checkReady(input: DraftInput) {
	const to = parseAddressList(input.to);
	const cc = parseAddressList(input.cc);
	if (to.invalid.length)
		throw new ServiceError(`Alamat tidak valid: ${to.invalid.join(', ')}`, 'to');
	if (cc.invalid.length)
		throw new ServiceError(`Alamat tidak valid: ${cc.invalid.join(', ')}`, 'cc');
	if (!to.addresses.length) throw new ServiceError('Isi minimal satu penerima.', 'to');
	if (to.addresses.length > 20 || cc.addresses.length > 20)
		throw new ServiceError('Maksimal 20 penerima.', 'to');
	if (!input.threadId && !input.forwardId && !input.subject.trim())
		throw new ServiceError('Isi subjek email.', 'subject');
	if (!input.forwardId && !htmlToText(input.body).trim() && !/<img\b/i.test(input.body))
		throw new ServiceError('Tulis isi email.', 'body');
}

/** Jadwalkan: save the draft as it is now, then queue its send at `at` */
export async function scheduleDraft(
	db: DbOrTx,
	userId: string,
	input: DraftInput,
	at: Date,
	deps: ScheduleDeps,
	now = new Date()
) {
	checkReady(input);
	if (at.getTime() < now.getTime() + (SCHEDULE_MIN_MINUTES - 1) * 60_000)
		throw new ServiceError(`Pilih waktu minimal ${SCHEDULE_MIN_MINUTES} menit dari sekarang.`);
	await saveDraft(db, userId, input, now);
	const [row] = await db
		.update(emailDraft)
		.set({ status: 'scheduled', scheduledAt: at, runId: null, error: null, updatedAt: now })
		.where(
			and(
				eq(emailDraft.id, input.id),
				eq(emailDraft.userId, userId),
				eq(emailDraft.status, 'draft')
			)
		)
		.returning({ id: emailDraft.id });
	if (!row) throw new ServiceError('Draf tidak ditemukan.');
	let runId: string;
	try {
		runId = await deps.queue(input.id, at);
	} catch (e) {
		console.error('[email] schedule failed:', String(e));
		await db.update(emailDraft).set({ status: 'draft' }).where(eq(emailDraft.id, input.id));
		throw new ServiceError('Jadwal gagal dibuat. Coba lagi sebentar lagi.');
	}
	await db.update(emailDraft).set({ runId }).where(eq(emailDraft.id, input.id));
	return { id: input.id, at };
}

/** Batalkan jadwal / Ubah: the email goes back to Draf (its time is kept for the next schedule) */
export async function unscheduleDraft(
	db: DbOrTx,
	userId: string,
	id: string,
	deps?: Pick<ScheduleDeps, 'cancel'>
) {
	const [row] = await db
		.select({ status: emailDraft.status, runId: emailDraft.runId })
		.from(emailDraft)
		.where(and(eq(emailDraft.id, id), eq(emailDraft.userId, userId)));
	if (!row) throw new ServiceError('Email terjadwal tidak ditemukan.');
	if (row.status === 'sending') throw new ServiceError('Email ini sedang dikirim.');
	if (row.status === 'draft') return;
	await db
		.update(emailDraft)
		.set({ status: 'draft', runId: null, error: null, updatedAt: new Date() })
		.where(and(eq(emailDraft.id, id), inArray(emailDraft.status, ['scheduled', 'failed'])));
	if (row.runId) await cancelQuietly(deps, row.runId);
}

/**
 * Send a claimed draft (status `sending`) as it was saved. The Resend key comes from the draft and
 * its last save, so a retry after a crash sends once. Sent = the draft is deleted.
 */
async function deliver(db: DbOrTx, draft: DraftRow, deps: SendDeps) {
	const to = parseAddressList(draft.to);
	const cc = parseAddressList(draft.cc);
	if (to.invalid.length || cc.invalid.length)
		throw new ServiceError(`Alamat tidak valid: ${[...to.invalid, ...cc.invalid].join(', ')}`);
	const uploads = await db
		.select({ id: emailFile.id })
		.from(emailFile)
		.where(and(eq(emailFile.draftId, draft.id), eq(emailFile.status, 'uploading')))
		.orderBy(asc(emailFile.createdAt));
	const sent = await sendEmailMessage(
		db,
		{
			threadId: draft.threadId ?? undefined,
			to: to.addresses,
			cc: cc.addresses,
			subject: draft.subject,
			body: draft.body,
			key: `${draft.id}-${draft.updatedAt.getTime()}`,
			uploads: uploads.map((u) => u.id),
			forward: draft.forwardEmailId
				? { emailId: draft.forwardEmailId, attachmentIds: draft.forwardFiles }
				: undefined
		},
		draft.userId,
		deps
	);
	await db.delete(emailDraft).where(eq(emailDraft.id, draft.id));
	return sent;
}

/** A scheduled send that could not go: back in Terjadwal as Gagal, with who to tell */
export async function markDraftFailed(db: DbOrTx, id: string, error: string) {
	const [row] = await db
		.update(emailDraft)
		.set({ status: 'failed', error: error.slice(0, 500), runId: null })
		.where(and(eq(emailDraft.id, id), inArray(emailDraft.status, ['scheduled', 'sending'])))
		.returning({ userId: emailDraft.userId, to: emailDraft.to, subject: emailDraft.subject });
	if (!row) return null;
	const [u] = await db
		.select({ chatId: user.telegramChatId })
		.from(user)
		.where(eq(user.id, row.userId));
	return { ...row, chatId: u?.chatId ?? null, error };
}

export type FailedDraft = NonNullable<Awaited<ReturnType<typeof markDraftFailed>>>;

/**
 * The delayed run (email-scheduled-send): sends the draft when it is still scheduled for about now.
 * A run left over from an earlier schedule finds it moved, cancelled or sent, and does nothing. A
 * rule the writer can fix (address, expired attachment) marks it Gagal; anything else is thrown so
 * the task retries.
 */
export async function sendScheduledDraft(
	db: DbOrTx,
	draftId: string,
	deps: SendDeps,
	now = new Date()
) {
	const [draft] = await db
		.update(emailDraft)
		.set({ status: 'sending' })
		.where(
			and(
				eq(emailDraft.id, draftId),
				// `sending`: a retry after a crash mid-send
				inArray(emailDraft.status, ['scheduled', 'sending']),
				lte(emailDraft.scheduledAt, new Date(now.getTime() + 60_000))
			)
		)
		.returning();
	if (!draft) return { status: 'skipped' as const };
	try {
		const sent = await deliver(db, draft, deps);
		return { status: 'sent' as const, threadId: sent.threadId };
	} catch (e) {
		if (!(e instanceof ServiceError)) throw e;
		const failed = await markDraftFailed(db, draftId, e.message);
		return { status: 'failed' as const, failed };
	}
}

/** Kirim sekarang from Terjadwal (also a Gagal one): send it from the app at once */
export async function sendDraftNow(
	db: DbOrTx,
	userId: string,
	id: string,
	deps: SendDeps & Pick<ScheduleDeps, 'cancel'>
) {
	const [before] = await db
		.select({ runId: emailDraft.runId })
		.from(emailDraft)
		.where(and(eq(emailDraft.id, id), eq(emailDraft.userId, userId)));
	const [draft] = await db
		.update(emailDraft)
		.set({ status: 'sending', scheduledAt: new Date(), runId: null })
		.where(
			and(
				eq(emailDraft.id, id),
				eq(emailDraft.userId, userId),
				inArray(emailDraft.status, ['scheduled', 'failed'])
			)
		)
		.returning();
	if (!draft) throw new ServiceError('Email terjadwal tidak ditemukan atau sedang dikirim.');
	if (before?.runId) await cancelQuietly(deps, before.runId);
	try {
		return await deliver(db, draft, deps);
	} catch (e) {
		await markDraftFailed(
			db,
			id,
			e instanceof ServiceError ? e.message : 'Email gagal dikirim. Coba lagi sebentar lagi.'
		);
		throw e;
	}
}

/** Telegram note to the writer when a scheduled email could not be sent */
export function scheduledFailedTelegram(f: FailedDraft, url: string) {
	return [
		'<b>Email terjadwal gagal dikirim</b>',
		`Kepada: ${escapeHtml(f.to || '–')}`,
		`Subjek: ${escapeHtml(f.subject || '(tanpa subjek)')}`,
		'',
		`<i>${escapeHtml(f.error)}</i>`,
		'',
		`<a href="${escapeHtml(url)}">Buka Terjadwal</a>`
	].join('\n');
}
