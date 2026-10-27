import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { emailLinkSchema } from '#lib/schemas/email.ts';
import { attachmentExpired, RESEND_RETENTION_DAYS, signatureHtml } from '#lib/email.ts';
import { db } from '#lib/server/db/index.ts';
import { sendEmailAction } from '#lib/server/email-actions.ts';
import { inboxFrom, resendKey, sendDeps } from '#lib/server/email-config.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import {
	getReceivedAttachment,
	getSentAttachments,
	pickSentAttachment
} from '#lib/server/notify/resend-inbound.ts';
import { listDealClients } from '#lib/server/services/deals.ts';
import {
	attachmentSource,
	emailSignature,
	getThread,
	linkThread,
	markThread,
	replyDefaults
} from '#lib/server/services/email.ts';
import type { Actions, PageServerLoad } from './$types';

function threadIdOr404(raw: string) {
	const id = z.uuid().safeParse(raw);
	if (!id.success) error(404, 'Email tidak ditemukan.');
	return id.data;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUser(locals);
	const threadId = threadIdOr404(params.id);
	const [thread, signature] = await Promise.all([
		getThread(db, threadId),
		emailSignature(db, user.id, sendDeps)
	]);
	if (!thread) error(404, 'Email tidak ditemukan.');
	// Opening a thread reads it; the page refreshes the sidebar badge afterwards
	const wasUnread = thread.messages.some((m) => m.direction === 'in' && !m.readAt);
	if (wasUnread) await markThread(db, threadId, true);
	return {
		thread,
		wasUnread,
		reply: replyDefaults(thread.messages, inboxFrom.email),
		signature: signatureHtml(signature),
		clients: thread.client ? [] : await listDealClients(db)
	};
};

export const actions: Actions = {
	send: sendEmailAction,

	link: async ({ request, params, locals }) => {
		const user = requireUser(locals);
		const threadId = threadIdOr404(params.id);
		const parsed = emailLinkSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		return runSimpleAction(
			() => linkThread(db, { threadId, ...parsed.data }, user.id),
			parsed.data.addContact
				? 'Email dihubungkan ke klien dan pengirim disimpan sebagai kontak.'
				: 'Email dihubungkan ke klien.'
		);
	},

	unread: async ({ params, locals }) => {
		requireUser(locals);
		const threadId = threadIdOr404(params.id);
		return runSimpleAction(() => markThread(db, threadId, false), 'Ditandai belum dibaca.');
	},

	/** Plain form (new tab): a fresh Resend link, valid for an hour; incoming and sent files */
	attachment: async ({ request, params, locals }) => {
		requireUser(locals);
		threadIdOr404(params.id);
		const form = await request.formData();
		const emailId = z.uuid().safeParse(form.get('emailId'));
		const attachmentId = z.string().min(1).max(100).safeParse(form.get('attachmentId'));
		if (!emailId.success || !attachmentId.success) error(404, 'Lampiran tidak ditemukan.');
		const source = await attachmentSource(db, emailId.data, attachmentId.data);
		if (!source) error(404, 'Lampiran tidak ditemukan.');
		if (attachmentExpired(source.sentAt))
			error(
				410,
				`Lampiran sudah tidak tersedia: Resend menyimpan file ${RESEND_RETENTION_DAYS} hari.`
			);
		let url: string | undefined;
		try {
			url =
				source.direction === 'in'
					? (await getReceivedAttachment(resendKey, source.resendId, attachmentId.data))
							.download_url
					: pickSentAttachment(
							await getSentAttachments(resendKey, source.resendId),
							source.filename,
							source.nth
						)?.download_url;
		} catch (e) {
			console.error('[email] attachment link failed:', String(e));
			error(502, 'Lampiran tidak bisa diambil dari Resend. Coba lagi sebentar lagi.');
		}
		if (!url) error(404, 'Lampiran tidak ditemukan di Resend.');
		// Download links live on Resend's CDN (cdn.resend.app); nothing else is followed
		const origin = new URL(url).origin;
		if (!/^https:\/\/([a-z0-9-]+\.)*resend\.(app|com)$/.test(origin))
			error(502, 'Lampiran tidak bisa diambil dari Resend. Coba lagi sebentar lagi.');
		redirect(303, url, { external: [origin] });
	}
};
