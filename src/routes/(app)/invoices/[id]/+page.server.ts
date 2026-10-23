import { error, fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { FormMessage } from '#lib/schemas/message.ts';
import { invoiceSchema, type InvoiceInput } from '#lib/schemas/invoice.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import {
	getInvoice,
	listInvoiceTargets,
	markInvoiceSent,
	updateInvoice,
	voidInvoice
} from '#lib/server/services/invoices.ts';
import type { Actions, PageServerLoad } from './$types';

function idOr404(raw: string) {
	const id = z.uuid().safeParse(raw);
	if (!id.success) error(404, 'Invoice tidak ditemukan.');
	return id.data;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	requireUser(locals);
	const id = idOr404(params.id);
	const [inv, targets] = await Promise.all([getInvoice(db, id), listInvoiceTargets(db)]);
	if (!inv) error(404, 'Invoice tidak ditemukan.');
	const form = await superValidate<InvoiceInput, FormMessage>(
		{
			id: inv.id,
			clientId: inv.clientId,
			projectId: inv.projectId ?? '',
			issueDate: inv.issueDate,
			dueDate: inv.dueDate,
			ppnRate: inv.ppnRate,
			pph23Rate: inv.pph23Rate,
			notes: inv.notes ?? '',
			items: inv.items.map((i) => ({
				description: i.description,
				qty: i.qty,
				unitPrice: i.unitPrice
			}))
		},
		zod4(invoiceSchema),
		{ errors: false }
	);
	return { invoice: inv, form, targets };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate<InvoiceInput, FormMessage>(request, zod4(invoiceSchema));
		if (!form.valid) return fail(400, { form });
		try {
			await updateInvoice(db, form.data, user.id);
			return message(form, { type: 'success', text: 'Invoice disimpan.' });
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'clientId' || e.field === 'projectId' || e.field === 'issueDate')
				return setError(form, e.field, e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	send: async ({ params, locals }) => {
		const user = requireUser(locals);
		const id = idOr404(params.id);
		return runSimpleAction(() => markInvoiceSent(db, id, user.id), 'Invoice ditandai terkirim.');
	},

	void: async ({ params, locals }) => {
		const user = requireUser(locals);
		const id = idOr404(params.id);
		return runSimpleAction(() => voidInvoice(db, id, user.id), 'Invoice dibatalkan.');
	}
};
