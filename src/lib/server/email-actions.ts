// Form action shared by the Email page (new email) and a thread (reply), P3-08. Multipart: the
// editor's HTML in `body`, attached files in `files`.
import { fail, type RequestEvent } from '@sveltejs/kit';
import { emailSendSchema } from '#lib/schemas/email.ts';
import { db } from '#lib/server/db/index.ts';
import { sendDeps } from '#lib/server/email-config.ts';
import { requireUser } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import { sendEmailMessage } from '#lib/server/services/email.ts';

/** `{ done, threadId }`, or `fail(400, { error, field })` with an Indonesian message */
export async function sendEmailAction({ request, locals }: RequestEvent) {
	const user = requireUser(locals);
	const form = await request.formData();
	const parsed = emailSendSchema.safeParse(Object.fromEntries(form));
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return fail(400, { error: issue.message, field: String(issue.path[0] ?? '') });
	}
	const { threadId, ...input } = parsed.data;
	try {
		const files = await Promise.all(
			form
				.getAll('files')
				.filter((f): f is File => f instanceof File && f.size > 0)
				.map(async (f) => ({
					filename: f.name,
					contentType: f.type,
					data: new Uint8Array(await f.arrayBuffer())
				}))
		);
		const sent = await sendEmailMessage(
			db,
			{ ...input, threadId: threadId || undefined, files },
			user.id,
			sendDeps
		);
		return { done: 'Email terkirim.', threadId: sent.threadId };
	} catch (e) {
		if (e instanceof ServiceError) return fail(400, { error: e.message, field: e.field ?? '' });
		console.error('[email] send failed:', String(e));
		return fail(400, { error: 'Email gagal dikirim. Coba lagi sebentar lagi.', field: '' });
	}
}
