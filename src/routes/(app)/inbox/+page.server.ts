import { z } from 'zod';
import { attachmentExpired, signatureHtml } from '#lib/email.ts';
import { db } from '#lib/server/db/index.ts';
import { mailboxActions, sendEmailAction, uploadFileAction } from '#lib/server/email-actions.ts';
import { sendDeps } from '#lib/server/email-config.ts';
import { requireUser } from '#lib/server/guards.ts';
import { triggerEnabled } from '#lib/server/trigger.ts';
import {
	emailSignature,
	INBOX_FILTERS,
	listThreads,
	threadCounts
} from '#lib/server/services/email.ts';
import { draftCounts, getDraft, listDrafts } from '#lib/server/services/email-drafts.ts';
import type { Actions, PageServerLoad } from './$types';

/** Thread filters, plus the writer's own Draf and Terjadwal (P3-09) */
const VIEWS = [...INBOX_FILTERS, 'drafts', 'scheduled'] as const;

const params = z.object({
	filter: z.enum(VIEWS).catch('all'),
	q: z.string().trim().max(100).optional().catch(undefined),
	page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
	/** "Kirim email" from a contact opens the form with this address */
	to: z.string().trim().max(300).optional().catch(undefined),
	/** A draft opened in the drawer */
	draft: z.uuid().optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requireUser(locals);
	const p = params.parse(Object.fromEntries(url.searchParams));
	const q = p.q || undefined;
	const draftView = p.filter === 'drafts' || p.filter === 'scheduled' ? p.filter : null;
	const [list, counts, drafts, own, signature, draft] = await Promise.all([
		draftView
			? null
			: listThreads(db, { filter: p.filter as (typeof INBOX_FILTERS)[number], q, page: p.page }),
		draftView ? threadCounts(db, q) : null,
		draftView ? listDrafts(db, user.id, draftView) : [],
		draftCounts(db, user.id),
		emailSignature(db, user.id, sendDeps),
		p.draft ? getDraft(db, user.id, p.draft) : null
	]);
	return {
		list,
		counts: { ...(list?.counts ?? counts!), drafts: own.drafts, scheduled: own.scheduled },
		drafts,
		// Only a draft that can be edited opens; a scheduled one is taken off the schedule first
		draft:
			draft && draft.status === 'draft'
				? {
						...draft,
						forward: draft.forward && {
							...draft.forward,
							attachments: draft.forward.attachments.filter((a) => !a.inline),
							expired: attachmentExpired(draft.forward.sentAt)
						}
					}
				: null,
		params: p,
		signature: signatureHtml(signature),
		canSchedule: triggerEnabled()
	};
};

export const actions: Actions = {
	send: sendEmailAction,
	upload: uploadFileAction,
	...mailboxActions
};
