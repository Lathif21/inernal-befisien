import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { TXN_STATUSES, TXN_TYPES } from '#lib/constants.ts';
import { resolvePeriod } from '#lib/period.ts';
import { transactionSchema } from '#lib/schemas/transaction.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { transactionActions } from '#lib/server/transaction-actions.ts';
import {
	financeTotals,
	listCategories,
	listTransactions,
	listTxnTargets
} from '#lib/server/services/transactions.ts';
import type { Actions, PageServerLoad } from './$types';

const params = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	type: z.enum(TXN_TYPES).optional().catch(undefined),
	status: z.enum(TXN_STATUSES).optional().catch(undefined),
	category: z.uuid().optional().catch(undefined),
	client: z.uuid().optional().catch(undefined),
	page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const p = params.parse(Object.fromEntries(url.searchParams));
	// Keuangan defaults to Bulanan, like the Dashboard
	const period = resolvePeriod(
		{
			period: url.searchParams.get('period'),
			from: url.searchParams.get('from'),
			to: url.searchParams.get('to')
		},
		{ defaultPeriod: 'month' }
	);

	const [list, totals, previous, categories, targets, form] = await Promise.all([
		listTransactions(
			db,
			{
				q: p.q || undefined,
				type: p.type,
				status: p.status,
				categoryId: p.category,
				clientId: p.client,
				from: period.from,
				to: period.to
			},
			{ page: p.page }
		),
		// KPI tiles: the period (and the client filter), not the table's other filters
		financeTotals(db, { clientId: p.client, from: period.from, to: period.to }),
		financeTotals(db, { clientId: p.client, from: period.prevFrom, to: period.prevTo }),
		listCategories(db),
		listTxnTargets(db),
		superValidate(zod4(transactionSchema))
	]);

	return { list, totals, previous, categories, targets, form, period, params: p };
};

export const actions: Actions = { ...transactionActions };
