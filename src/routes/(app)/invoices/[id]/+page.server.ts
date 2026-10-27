import { error, fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { rupiah } from '#lib/format.ts';
import { PAYABLE_INVOICE_STATUSES } from '#lib/invoice.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { invoiceSchema, paymentSchema, type InvoiceInput } from '#lib/schemas/invoice.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { getCompanyProfile } from '#lib/server/services/company.ts';
import {
	deleteInvoicePayment,
	getInvoicePayments,
	linkableTransactions,
	recordPayment,
	unlinkInvoicePayment
} from '#lib/server/services/invoice-payments.ts';
import { listCategories } from '#lib/server/services/transactions.ts';
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
	const [inv, targets, company] = await Promise.all([
		getInvoice(db, id),
		listInvoiceTargets(db),
		getCompanyProfile(db)
	]);
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
	const payable = (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status);
	const [payments, categories, linkable] = await Promise.all([
		getInvoicePayments(db, inv),
		listCategories(db).then((all) => all.filter((c) => c.type === 'income')),
		payable ? linkableTransactions(db, inv) : Promise.resolve([])
	]);
	return {
		invoice: inv,
		form,
		targets,
		companyIsExample: company.isExample,
		payments,
		categories,
		linkable
	};
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
	},

	/** From the payment modal (fetch): { done } or fail(400, { error, fields? }) */
	pay: async ({ params, request, locals }) => {
		const user = requireUser(locals);
		const id = idOr404(params.id);
		const parsed = paymentSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			const fields: Record<string, string> = {};
			for (const i of parsed.error.issues) fields[String(i.path[0])] ??= i.message;
			return fail(400, { error: 'Periksa pembayarannya.', fields });
		}
		try {
			const { status, linked } = await recordPayment(db, id, parsed.data, user.id);
			return {
				done: `Pembayaran ${rupiah(parsed.data.amount)} ${linked ? 'dari Keuangan dihubungkan' : 'dicatat'}${status === 'paid' ? '. Invoice lunas.' : '.'}`
			};
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			return fail(400, {
				error: e.message,
				fields:
					e.field === 'amount' || e.field === 'transactionId' ? { [e.field]: e.message } : undefined
			});
		}
	},

	deletePayment: async ({ params, request, locals }) => {
		const user = requireUser(locals);
		const id = idOr404(params.id);
		const txnId = z.uuid().safeParse((await request.formData()).get('id'));
		if (!txnId.success) return fail(400, { error: 'Pembayaran tidak valid.' });
		return runSimpleAction(
			() => deleteInvoicePayment(db, id, txnId.data, user.id),
			'Pembayaran dihapus.'
		);
	},

	/** "Lepas dari invoice": keeps the row in Keuangan, without the link */
	unlinkPayment: async ({ params, request, locals }) => {
		const user = requireUser(locals);
		const id = idOr404(params.id);
		const txnId = z.uuid().safeParse((await request.formData()).get('id'));
		if (!txnId.success) return fail(400, { error: 'Pembayaran tidak valid.' });
		return runSimpleAction(
			() => unlinkInvoicePayment(db, id, txnId.data, user.id),
			'Pembayaran dilepas dari invoice. Transaksinya tetap ada di Keuangan.'
		);
	}
};
