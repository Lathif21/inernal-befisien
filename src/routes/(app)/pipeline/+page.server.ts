import { fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { SERVICE_TYPES } from '#lib/constants.ts';
import { nextActionState } from '#lib/next-action.ts';
import { dealSchema, moveSchema, wonProjectSchema, type DealInput } from '#lib/schemas/deal.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { stepFieldsFrom, stepSchema } from '#lib/schemas/step.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { stepActions } from '#lib/server/step-actions.ts';
import { listOwners } from '#lib/server/services/clients.ts';
import {
	createDeal,
	createProjectForWonDeal,
	getDealDetail,
	listBoardDeals,
	listDealClients,
	moveDeal,
	updateDeal
} from '#lib/server/services/deals.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import type { Actions, PageServerLoad } from './$types';

const boardParams = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	owner: z.string().max(64).optional().catch(undefined),
	service: z.enum(SERVICE_TYPES).optional().catch(undefined),
	late: z.literal('1').optional().catch(undefined),
	deal: z.uuid().optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const params = boardParams.parse(Object.fromEntries(url.searchParams));

	const [deals, owners, clients, dealForm, detail] = await Promise.all([
		listBoardDeals(db, {
			q: params.q || undefined,
			ownerId: params.owner || undefined,
			serviceType: params.service
		}),
		listOwners(db),
		listDealClients(db),
		superValidate(zod4(dealSchema)),
		params.deal ? getDealDetail(db, params.deal) : Promise.resolve(null)
	]);

	const now = new Date();
	const isLate = (d: (typeof deals)[number]) =>
		!!d.next &&
		d.stage !== 'won' &&
		d.stage !== 'lost' &&
		nextActionState(d.next.dueAt, now, d.next.allDay) === 'late';
	const lateCount = deals.filter(isLate).length;

	return {
		deals: params.late ? deals.filter(isLate) : deals,
		lateCount,
		owners,
		clients,
		dealForm,
		detail,
		params
	};
};

/** fail(400) for a rule violation, so the board can roll back and show the message */
function serviceFailure(e: unknown) {
	if (e instanceof ServiceError) return fail(400, { error: e.message });
	throw e;
}

/** First Zod message per field, for the won / lost modals */
function fieldErrors(issues: z.core.$ZodIssue[]) {
	const out: Record<string, string> = {};
	for (const i of issues) out[String(i.path[0])] ??= i.message;
	return out;
}

export const actions: Actions = {
	...stepActions,
	saveDeal: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate<DealInput, FormMessage>(request, zod4(dealSchema));
		if (!form.valid) return fail(400, { form });
		try {
			const row = form.data.id
				? await updateDeal(db, form.data.id, form.data, user.id)
				: await createDeal(db, form.data, user.id);
			return message(form, {
				type: 'success',
				text: form.data.id ? `Deal "${row.title}" disimpan.` : `Deal "${row.title}" ditambahkan.`
			});
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'clientId' || e.field === 'ownerId')
				return setError(form, e.field, e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	/** Board move (drag or "Pindah ke…"); won may carry the new project's fields */
	move: async ({ request, locals }) => {
		const user = requireUser(locals);
		const data = Object.fromEntries(await request.formData());
		const move = moveSchema.safeParse(data);
		if (!move.success) {
			return fail(400, {
				error: 'Data perpindahan tidak lengkap.',
				fields: fieldErrors(move.error.issues)
			});
		}
		// Reopening a won / lost card brings its next step (next.*), like completing a step does
		let next = null;
		if (typeof data['next.title'] === 'string') {
			const step = stepSchema.safeParse(stepFieldsFrom(data, 'next.'));
			if (!step.success)
				return fail(400, { error: 'Periksa langkahnya.', fields: fieldErrors(step.error.issues) });
			next = step.data;
		}
		let wonProject = null;
		if (move.data.to === 'won' && move.data.createProject === 'yes') {
			const p = wonProjectSchema.safeParse(data);
			if (!p.success)
				return fail(400, { error: 'Lengkapi data proyek.', fields: fieldErrors(p.error.issues) });
			wonProject = p.data;
		}
		try {
			const { projectId } = await moveDeal(db, move.data, wonProject, user.id, next);
			return { done: projectId ? 'Deal menang. Proyek dibuat.' : 'Deal dipindahkan.', projectId };
		} catch (e) {
			return serviceFailure(e);
		}
	},

	/** "Buat proyek" later, for a won deal that has none yet */
	createProject: async ({ request, locals }) => {
		const user = requireUser(locals);
		const data = Object.fromEntries(await request.formData());
		const id = z.uuid().safeParse(data.id);
		const p = wonProjectSchema.safeParse(data);
		if (!id.success) return fail(400, { error: 'Deal tidak valid.' });
		if (!p.success)
			return fail(400, { error: 'Lengkapi data proyek.', fields: fieldErrors(p.error.issues) });
		try {
			const projectId = await createProjectForWonDeal(db, id.data, p.data, user.id);
			return { done: 'Proyek dibuat.', projectId };
		} catch (e) {
			return serviceFailure(e);
		}
	}
};
