// Form actions for transactions, mounted by Keuangan and Detail Klien:
//   export const actions = { ...transactionActions, ... }
import { fail, type RequestEvent } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { TXN_TYPE_LABELS } from '#lib/constants.ts';
import { rupiah } from '#lib/format.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { transactionSchema, type TransactionInput } from '#lib/schemas/transaction.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import {
	createTransaction,
	deleteTransaction,
	updateTransaction
} from '#lib/server/services/transactions.ts';

const FIELDS = ['clientId', 'projectId', 'categoryId'] as const;

export const transactionActions = {
	saveTransaction: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const form = await superValidate<TransactionInput, FormMessage>(
			request,
			zod4(transactionSchema)
		);
		if (!form.valid) return fail(400, { form });
		try {
			const row = form.data.id
				? await updateTransaction(db, form.data, user.id)
				: await createTransaction(db, form.data, user.id);
			return message(form, {
				type: 'success',
				text: form.data.id
					? 'Transaksi disimpan.'
					: `${TXN_TYPE_LABELS[row.type].long} ${rupiah(row.amount)} dicatat.`
			});
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			const field = FIELDS.find((f) => f === e.field);
			if (field) return setError(form, field, e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	deleteTransaction: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const id = z.uuid().safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Transaksi tidak valid.' });
		return runSimpleAction(() => deleteTransaction(db, id.data, user.id), 'Transaksi dihapus.');
	}
};
