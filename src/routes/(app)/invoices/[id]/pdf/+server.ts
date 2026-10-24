import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { invoiceFileName, renderInvoicePdf } from '#lib/server/pdf/invoice-pdf.ts';
import { getCompanyProfile } from '#lib/server/services/company.ts';
import { getInvoice } from '#lib/server/services/invoices.ts';
import type { RequestHandler } from './$types';

/** The invoice as a PDF, from its saved data. `?view` opens it in the browser instead of downloading. */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	requireUser(locals);
	const id = z.uuid().safeParse(params.id);
	if (!id.success) error(404, 'Invoice tidak ditemukan.');
	const [inv, company] = await Promise.all([getInvoice(db, id.data), getCompanyProfile(db)]);
	if (!inv) error(404, 'Invoice tidak ditemukan.');
	const pdf = await renderInvoicePdf(inv, company);
	const disposition = url.searchParams.has('view') ? 'inline' : 'attachment';
	return new Response(new Uint8Array(pdf), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `${disposition}; filename="${invoiceFileName(inv.number)}"`,
			'cache-control': 'private, no-store'
		}
	});
};
