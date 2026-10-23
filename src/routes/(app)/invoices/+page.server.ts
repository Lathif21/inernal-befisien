import { z } from 'zod';
import { INVOICE_STATUSES } from '#lib/constants.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { listInvoices } from '#lib/server/services/invoices.ts';
import type { PageServerLoad } from './$types';

const params = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	status: z.enum(INVOICE_STATUSES).optional().catch(undefined),
	page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const p = params.parse(Object.fromEntries(url.searchParams));
	const list = await listInvoices(db, { q: p.q || undefined, status: p.status, page: p.page });
	return { list, params: p };
};
