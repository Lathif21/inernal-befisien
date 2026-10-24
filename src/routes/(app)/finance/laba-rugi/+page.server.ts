import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { dayKeyWib } from '#lib/format.ts';
import { transactionSchema } from '#lib/schemas/transaction.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { profitLoss } from '#lib/server/services/profit-loss.ts';
import { listCategories, listTxnTargets } from '#lib/server/services/transactions.ts';
import { transactionActions } from '#lib/server/transaction-actions.ts';
import type { Actions, PageServerLoad } from './$types';

const params = z.object({
	year: z.coerce.number().int().min(2020).max(2100).optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const today = dayKeyWib();
	const thisYear = Number(today.slice(0, 4));
	const year = params.parse(Object.fromEntries(url.searchParams)).year ?? thisYear;
	const [pl, categories, targets, form] = await Promise.all([
		profitLoss(db, year),
		listCategories(db),
		listTxnTargets(db),
		superValidate(zod4(transactionSchema))
	]);
	// Months after the current one (WIB) have no numbers yet
	const lastMonth = year < thisYear ? 12 : year === thisYear ? Number(today.slice(5, 7)) : 0;
	return { pl, categories, targets, form, thisYear, lastMonth };
};

export const actions: Actions = { ...transactionActions };
