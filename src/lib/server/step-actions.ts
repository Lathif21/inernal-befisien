// Form actions for steps, mounted by every page that shows cards (Pipeline, Proyek, Strategi):
//   export const actions = { ...stepActions, ... }
// Each returns { done } or fail(400, { error, fields?, needNext? }).
import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { stepFieldsFrom, stepSchema } from '#lib/schemas/step.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { addAction, completeAction, updateAction } from '#lib/server/services/actions.ts';
import { ServiceError } from '#lib/server/services/errors.ts';

const id = z.uuid();
const card = z.object({ cardType: z.enum(['deal', 'project']), cardId: z.uuid() });

function fieldErrors(issues: z.core.$ZodIssue[]) {
	const out: Record<string, string> = {};
	for (const i of issues) out[String(i.path[0])] ??= i.message;
	return out;
}

function failure(e: unknown) {
	if (!(e instanceof ServiceError)) throw e;
	return fail(400, {
		error: e.message,
		needNext: e.field === 'next',
		fields: e.field && e.field !== 'next' ? { [e.field]: e.message } : undefined
	});
}

async function formOf(event: RequestEvent) {
	return Object.fromEntries(await event.request.formData());
}

export const stepActions = {
	addStep: async (event: RequestEvent) => {
		const user = requireUser(event.locals);
		const data = await formOf(event);
		const target = card.safeParse(data);
		if (!target.success) return fail(400, { error: 'Kartu tidak valid.' });
		const step = stepSchema.safeParse(stepFieldsFrom(data));
		if (!step.success)
			return fail(400, { error: 'Periksa langkahnya.', fields: fieldErrors(step.error.issues) });
		const ref =
			target.data.cardType === 'deal'
				? { dealId: target.data.cardId }
				: { projectId: target.data.cardId };
		try {
			await addAction(db, ref, step.data, user.id);
			return { done: 'Langkah ditambahkan.' };
		} catch (e) {
			return failure(e);
		}
	},

	updateStep: async (event: RequestEvent) => {
		const user = requireUser(event.locals);
		const data = await formOf(event);
		const stepId = id.safeParse(data.id);
		if (!stepId.success) return fail(400, { error: 'Langkah tidak valid.' });
		const step = stepSchema.safeParse(stepFieldsFrom(data));
		if (!step.success)
			return fail(400, { error: 'Periksa langkahnya.', fields: fieldErrors(step.error.issues) });
		try {
			await updateAction(db, stepId.data, step.data, user.id);
			return { done: 'Langkah disimpan.' };
		} catch (e) {
			return failure(e);
		}
	},

	/** Tick off; may carry the next step (next.* fields) and "Pindahkan ke tahap berikutnya" */
	completeStep: async (event: RequestEvent) => {
		const user = requireUser(event.locals);
		const data = await formOf(event);
		const stepId = id.safeParse(data.id);
		if (!stepId.success) return fail(400, { error: 'Langkah tidak valid.' });
		let next = null;
		if (data.withNext === 'yes') {
			const parsed = stepSchema.safeParse(stepFieldsFrom(data, 'next.'));
			if (!parsed.success) {
				return fail(400, {
					error: 'Periksa langkah berikutnya.',
					fields: fieldErrors(parsed.error.issues)
				});
			}
			next = parsed.data;
		}
		try {
			const { open } = await completeAction(
				db,
				stepId.data,
				{ next, moveToNextStage: data.moveToNextStage === 'yes' },
				user.id
			);
			return {
				done: next ? 'Langkah selesai. Langkah berikutnya dijadwalkan.' : 'Langkah selesai.',
				open
			};
		} catch (e) {
			return failure(e);
		}
	}
};
