import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { sendEmailAction } from '#lib/server/email-actions.ts';
import { requireUser } from '#lib/server/guards.ts';
import { INBOX_FILTERS, listThreads } from '#lib/server/services/email.ts';
import type { Actions, PageServerLoad } from './$types';

const params = z.object({
	filter: z.enum(INBOX_FILTERS).catch('all'),
	q: z.string().trim().max(100).optional().catch(undefined),
	page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
	/** "Kirim email" from a contact opens the form with this address */
	to: z.string().trim().max(300).optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const p = params.parse(Object.fromEntries(url.searchParams));
	const list = await listThreads(db, { filter: p.filter, q: p.q || undefined, page: p.page });
	return { list, params: p };
};

export const actions: Actions = { send: sendEmailAction };
