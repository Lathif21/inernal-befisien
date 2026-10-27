import { fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { resolvePeriod } from '#lib/period.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { planSchema, type PlanInput } from '#lib/schemas/plan.ts';
import { stepFieldsFrom, stepSchema } from '#lib/schemas/step.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { listOwners } from '#lib/server/services/clients.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import {
	addPlanStep,
	attentionSteps,
	createPlan,
	listPlanCards,
	listPlans,
	moveStep,
	scheduleSteps,
	setPlanStatus,
	updatePlan
} from '#lib/server/services/plans.ts';
import { stepActions } from '#lib/server/step-actions.ts';
import { stepRunActions } from '#lib/server/step-run-actions.ts';
import { aiActions } from '#lib/server/ai-actions.ts';
import { aiEnabled } from '#lib/server/ai-config.ts';
import { scheduleText } from '#lib/ai-schedule.ts';
import { getAiSettings } from '#lib/server/services/ai-settings.ts';
import { listOpenSuggestions } from '#lib/server/services/ai-suggestions.ts';
import type { Actions, PageServerLoad } from './$types';

const params = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	mine: z.literal('1').optional().catch(undefined),
	plans: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requireUser(locals);
	const p = params.parse(Object.fromEntries(url.searchParams));
	// Strategi defaults to Mingguan (docs/design-system/components/PeriodFilter)
	const period = resolvePeriod(
		{
			period: url.searchParams.get('period'),
			from: url.searchParams.get('from'),
			to: url.searchParams.get('to')
		},
		{ defaultPeriod: 'week' }
	);
	const filters = { q: p.q || undefined, mineOf: p.mine ? user.id : undefined };

	const [plans, attention, schedule, owners, cards, planForm, suggestions] = await Promise.all([
		listPlans(db, { ...filters, page: p.plans }),
		attentionSteps(db, filters),
		scheduleSteps(db, period.fromInstant, period.toInstant, filters),
		listOwners(db),
		listPlanCards(db),
		superValidate(zod4(planSchema)),
		listOpenSuggestions(db)
	]);
	const aiSettings = await getAiSettings(db);

	return {
		plans,
		attention,
		schedule,
		owners,
		cards,
		planForm,
		suggestions,
		aiEnabled: aiEnabled(),
		// Pengaturan → Saran AI (Ringkasan konteks keeps `aiEnabled` only)
		aiSuggestionsOn: aiSettings.enabled,
		aiSchedule: scheduleText(aiSettings),
		period,
		params: p
	};
};

function fieldErrors(issues: z.core.$ZodIssue[]) {
	const out: Record<string, string> = {};
	for (const i of issues) out[String(i.path[0])] ??= i.message;
	return out;
}

const uuid = z.uuid();

export const actions: Actions = {
	...stepActions,
	...stepRunActions,
	...aiActions,

	savePlan: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate<PlanInput, FormMessage>(request, zod4(planSchema));
		if (!form.valid) return fail(400, { form });
		try {
			const row = form.data.id
				? await updatePlan(db, form.data.id, form.data, user.id)
				: await createPlan(db, form.data, user.id);
			return message(form, {
				type: 'success',
				text: form.data.id ? 'Rencana disimpan.' : `Rencana "${row.goal}" dibuat.`
			});
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'card') return setError(form, 'card', e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	planStatus: async ({ request, locals }) => {
		const user = requireUser(locals);
		const data = Object.fromEntries(await request.formData());
		const id = uuid.safeParse(data.id);
		const status = z.enum(['achieved', 'dropped', 'active']).safeParse(data.status);
		if (!id.success || !status.success) return fail(400, { error: 'Data tidak valid.' });
		// Dropping deletes the plan's open steps; the card may need a next step (next.* fields)
		let next = null;
		if (status.data === 'dropped' && data.withNext === 'yes') {
			const parsed = stepSchema.safeParse(stepFieldsFrom(data, 'next.'));
			if (!parsed.success)
				return fail(400, {
					error: 'Periksa langkah berikutnya.',
					fields: fieldErrors(parsed.error.issues)
				});
			next = parsed.data;
		}
		const text = {
			achieved: 'Rencana tercapai.',
			dropped: 'Rencana dibatalkan. Langkah terbukanya dihapus.',
			active: 'Rencana aktif lagi.'
		};
		return runSimpleAction(
			() => setPlanStatus(db, id.data, status.data, user.id, next),
			text[status.data]
		);
	},

	addPlanStep: async ({ request, locals }) => {
		const user = requireUser(locals);
		const data = Object.fromEntries(await request.formData());
		const planId = uuid.safeParse(data.planId);
		if (!planId.success) return fail(400, { error: 'Rencana tidak valid.' });
		const step = stepSchema.safeParse(stepFieldsFrom(data));
		if (!step.success)
			return fail(400, { error: 'Periksa langkahnya.', fields: fieldErrors(step.error.issues) });
		try {
			await addPlanStep(db, planId.data, step.data, user.id);
			return { done: 'Langkah ditambahkan ke rencana.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	moveStep: async ({ request, locals }) => {
		requireUser(locals);
		const data = Object.fromEntries(await request.formData());
		const id = uuid.safeParse(data.id);
		const dir = z.enum(['up', 'down']).safeParse(data.direction);
		if (!id.success || !dir.success) return fail(400, { error: 'Data tidak valid.' });
		return runSimpleAction(() => moveStep(db, id.data, dir.data), 'Urutan langkah diubah.');
	}
};
