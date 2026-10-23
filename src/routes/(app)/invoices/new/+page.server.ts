import { fail, redirect } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { resolve } from '$app/paths';
import { dayKeyWib } from '#lib/format.ts';
import { addDays } from '#lib/period.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { invoiceSchema, type InvoiceInput } from '#lib/schemas/invoice.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import { createInvoice, listInvoiceTargets } from '#lib/server/services/invoices.ts';
import type { Actions, PageServerLoad } from './$types';

const prefill = z.object({
	client: z.uuid().optional().catch(undefined),
	project: z.uuid().optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const p = prefill.parse(Object.fromEntries(url.searchParams));
	const targets = await listInvoiceTargets(db);
	const project = p.project ? targets.projects.find((x) => x.id === p.project) : undefined;
	const today = dayKeyWib();
	const form = await superValidate<InvoiceInput, FormMessage>(
		{
			clientId: project?.clientId ?? p.client ?? '',
			projectId: project?.id ?? '',
			issueDate: today,
			dueDate: addDays(today, 14),
			items: [
				{
					description: project ? project.name : '',
					qty: 1,
					unitPrice: project?.contractValue ?? 0
				}
			]
		},
		zod4(invoiceSchema),
		{ errors: false }
	);
	return { form, targets };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate<InvoiceInput, FormMessage>(request, zod4(invoiceSchema));
		if (!form.valid) return fail(400, { form });
		let id: string;
		try {
			id = (await createInvoice(db, form.data, user.id)).id;
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'clientId' || e.field === 'projectId')
				return setError(form, e.field, e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
		redirect(303, resolve('/(app)/invoices/[id]', { id }));
	}
};
