// Form actions shared by the Email page (new email) and a thread (reply / forward), P3-08. Files
// never pass through here: the drawer asks `upload` for a presigned PUT, the browser uploads to
// the Neon bucket itself, and `send` gets the email_file ids in `uploads`. Drafts, Jadwalkan and
// Sampah (P3-09) are in `mailboxActions`.
import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { parseSendAt, sendAtLabel } from '#lib/email-draft.ts';
import { emailDraftSchema, emailScheduleSchema, emailSendSchema } from '#lib/schemas/email.ts';
import { db } from '#lib/server/db/index.ts';
import { fileStorage, sendDeps } from '#lib/server/email-config.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { emailSchedule, triggerEnabled } from '#lib/server/trigger.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import {
	deleteThreadForever,
	purgeTrash,
	restoreThread,
	sendEmailMessage,
	trashThread
} from '#lib/server/services/email.ts';
import {
	deleteDraft,
	dropSentDraft,
	saveDraft,
	scheduleDraft,
	sendDraftNow,
	unscheduleDraft,
	type DraftInput
} from '#lib/server/services/email-drafts.ts';
import { createUpload } from '#lib/server/services/email-files.ts';

/** Repeated form fields (`uploads`, `forwardFiles`) */
const ids = (form: FormData, name: string) =>
	form
		.getAll(name)
		.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100);

const uuids = (form: FormData, name: string) =>
	ids(form, name).filter((v) => z.uuid().safeParse(v).success);

/** `{ done, threadId }`, or `fail(400, { error, field })` with an Indonesian message */
export async function sendEmailAction({ request, locals }: RequestEvent) {
	const user = requireUser(locals);
	const form = await request.formData();
	const parsed = emailSendSchema.safeParse(Object.fromEntries(form));
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return fail(400, { error: issue.message, field: String(issue.path[0] ?? '') });
	}
	const { threadId, forwardId, draftId, ...input } = parsed.data;
	// One `forwardFiles` entry per original attachment ticked in the drawer
	const forwardFiles = ids(form, 'forwardFiles');
	const uploads = uuids(form, 'uploads');
	try {
		const sent = await sendEmailMessage(
			db,
			{
				...input,
				threadId: threadId || undefined,
				uploads,
				forward: forwardId ? { emailId: forwardId, attachmentIds: forwardFiles } : undefined
			},
			user.id,
			sendDeps
		);
		if (draftId) await dropSentDraft(db, user.id, draftId);
		return {
			done: forwardId ? 'Email diteruskan.' : 'Email terkirim.',
			threadId: sent.threadId
		};
	} catch (e) {
		if (e instanceof ServiceError) return fail(400, { error: e.message, field: e.field ?? '' });
		console.error('[email] send failed:', String(e));
		return fail(400, { error: 'Email gagal dikirim. Coba lagi sebentar lagi.', field: '' });
	}
}

const uploadSchema = z.object({
	filename: z.string().trim().min(1).max(255),
	size: z.coerce.number().int().positive(),
	contentType: z.string().trim().max(150).default('')
});

/** `{ fileId, url, contentType }`: the browser PUTs the file to `url` with that Content-Type */
export async function uploadFileAction({ request, locals }: RequestEvent) {
	const user = requireUser(locals);
	if (!fileStorage)
		return fail(400, { error: 'Penyimpanan file belum diatur (NEON_STORAGE_*). Hubungi admin.' });
	const parsed = uploadSchema.safeParse(Object.fromEntries(await request.formData()));
	if (!parsed.success) return fail(400, { error: 'File tidak valid.' });
	try {
		return await createUpload(db, fileStorage, parsed.data, user.id);
	} catch (e) {
		if (e instanceof ServiceError) return fail(400, { error: e.message });
		throw e;
	}
}

/** The drawer's form as a draft, or a `fail` to return */
function draftInput(form: FormData): { input: DraftInput } | { failure: ReturnType<typeof fail> } {
	const parsed = emailDraftSchema.safeParse(Object.fromEntries(form));
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { failure: fail(400, { error: issue.message, field: String(issue.path[0] ?? '') }) };
	}
	const { draftId, ...rest } = parsed.data;
	return {
		input: {
			...rest,
			id: draftId,
			uploads: uuids(form, 'uploads'),
			forwardFiles: ids(form, 'forwardFiles')
		}
	};
}

const formId = (form: FormData, name: string) => {
	const v = z.uuid().safeParse(form.get(name));
	return v.success ? v.data : null;
};

/** Run a service call; a ServiceError becomes `fail(400, { error, field })` */
async function attempt<T>(work: () => Promise<T>) {
	try {
		return { ok: true as const, value: await work() };
	} catch (e) {
		if (e instanceof ServiceError)
			return { ok: false as const, failure: fail(400, { error: e.message, field: e.field ?? '' }) };
		throw e;
	}
}

/** Drafts, Jadwalkan and Sampah (P3-09), mounted on /inbox and /inbox/[id] */
export const mailboxActions = {
	/** Saved by the drawer while typing and on closing: `{ draftId, savedAt }` (null id = emptied) */
	saveDraft: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const draft = draftInput(await request.formData());
		if ('failure' in draft) return draft.failure;
		const r = await attempt(() => saveDraft(db, user.id, draft.input));
		if (!r.ok) return r.failure;
		return { draftId: r.value.id, savedAt: r.value.savedAt.toISOString() };
	},

	deleteDraft: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const id = formId(await request.formData(), 'draftId');
		if (!id) return fail(400, { error: 'Draf tidak ditemukan.' });
		return runSimpleAction(() => deleteDraft(db, user.id, id, emailSchedule), 'Draf dibuang.');
	},

	/** The drawer's Jadwalkan kirim: saves the draft and queues the send */
	schedule: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const form = await request.formData();
		if (!triggerEnabled())
			return fail(400, {
				error: 'Jadwal kirim belum aktif (TRIGGER_SECRET_KEY belum diatur). Hubungi admin.',
				field: ''
			});
		const draft = draftInput(form);
		if ('failure' in draft) return draft.failure;
		const when = emailScheduleSchema.safeParse(Object.fromEntries(form));
		if (!when.success) return fail(400, { error: when.error.issues[0].message, field: 'sendAt' });
		const at = parseSendAt(when.data.sendDate, when.data.sendTime);
		if ('error' in at) return fail(400, { error: at.error, field: 'sendAt' });
		const r = await attempt(() => scheduleDraft(db, user.id, draft.input, at.at, emailSchedule));
		if (!r.ok) return r.failure;
		return { done: `Email dijadwalkan ${sendAtLabel(at.at)} WIB.`, draftId: draft.input.id };
	},

	/** Batalkan jadwal, and Ubah (the drawer opens on the draft afterwards) */
	unschedule: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const id = formId(await request.formData(), 'draftId');
		if (!id) return fail(400, { error: 'Email terjadwal tidak ditemukan.' });
		const r = await attempt(() => unscheduleDraft(db, user.id, id, emailSchedule));
		if (!r.ok) return r.failure;
		return { done: 'Jadwal dibatalkan. Email dipindah ke Draf.', draftId: id };
	},

	sendNow: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const id = formId(await request.formData(), 'draftId');
		if (!id) return fail(400, { error: 'Email terjadwal tidak ditemukan.' });
		try {
			await sendDraftNow(db, user.id, id, { ...sendDeps, cancel: emailSchedule.cancel });
			return { done: 'Email terkirim.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			console.error('[email] send now failed:', String(e));
			return fail(400, { error: 'Email gagal dikirim. Coba lagi sebentar lagi.' });
		}
	},

	trash: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const id = formId(await request.formData(), 'threadId');
		if (!id) return fail(400, { error: 'Percakapan email tidak ditemukan.' });
		return runSimpleAction(() => trashThread(db, id, user.id), 'Percakapan dipindah ke Sampah.');
	},

	restore: async ({ request, locals }: RequestEvent) => {
		requireUser(locals);
		const id = formId(await request.formData(), 'threadId');
		if (!id) return fail(400, { error: 'Percakapan email tidak ditemukan.' });
		return runSimpleAction(() => restoreThread(db, id), 'Percakapan dipulihkan.');
	},

	deleteForever: async ({ request, locals }: RequestEvent) => {
		requireUser(locals);
		const id = formId(await request.formData(), 'threadId');
		if (!id) return fail(400, { error: 'Percakapan email tidak ditemukan.' });
		return runSimpleAction(() => deleteThreadForever(db, id), 'Percakapan dihapus permanen.');
	},

	emptyTrash: async ({ locals }: RequestEvent) => {
		requireUser(locals);
		const { threads } = await purgeTrash(db, { all: true });
		return { done: threads ? `${threads} percakapan dihapus permanen.` : 'Sampah sudah kosong.' };
	}
};
