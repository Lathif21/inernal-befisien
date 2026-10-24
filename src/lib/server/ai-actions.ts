// Form actions for AI suggestions, mounted by Strategi and Detail Klien:
//   export const actions = { ...aiActions, ... }
// Each returns { done } or fail(400, { error, fields? }).
import { fail, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { stepFieldsFrom, stepSchema } from '#lib/schemas/step.ts';
import { aiComplete, aiEnabled } from '#lib/server/ai-config.ts';
import { db } from '#lib/server/db/index.ts';
import { strategyPlan } from '#lib/server/db/schema/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import {
	acceptSuggestion,
	dismissSuggestion,
	generateSuggestions
} from '#lib/server/services/ai-suggestions.ts';
import { refreshClientContext, saveClientContext } from '#lib/server/services/client-context.ts';
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
		fields: e.field === 'target' ? { target: e.message } : undefined
	});
}

export const aiActions = {
	/** "Buat langkah" / "Tambahkan ke rencana": the edited step fields, plus a card when needed */
	acceptSuggestion: async (event: RequestEvent) => {
		const user = requireUser(event.locals);
		const data = Object.fromEntries(await event.request.formData());
		const suggestionId = id.safeParse(data.id);
		if (!suggestionId.success) return fail(400, { error: 'Saran tidak valid.' });
		const step = stepSchema.safeParse(stepFieldsFrom(data));
		if (!step.success)
			return fail(400, { error: 'Periksa langkahnya.', fields: fieldErrors(step.error.issues) });
		const target = data.cardId ? card.safeParse(data) : null;
		if (target && !target.success) return fail(400, { error: 'Pilih deal atau proyek.' });
		try {
			const created = await acceptSuggestion(
				db,
				suggestionId.data,
				{
					title: step.data.title,
					dueAt: `${step.data.dueDate}T${step.data.dueTime || '00:00'}`,
					allDay: step.data.allDay,
					assigneeId: step.data.assigneeId,
					target: target?.success
						? target.data.cardType === 'deal'
							? { dealId: target.data.cardId }
							: { projectId: target.data.cardId }
						: undefined
				},
				user.id
			);
			return { done: `Langkah "${created.title}" ditambahkan.` };
		} catch (e) {
			return failure(e);
		}
	},

	dismissSuggestion: async (event: RequestEvent) => {
		const user = requireUser(event.locals);
		const suggestionId = id.safeParse((await event.request.formData()).get('id'));
		if (!suggestionId.success) return fail(400, { error: 'Saran tidak valid.' });
		try {
			await dismissSuggestion(db, suggestionId.data, user.id);
			return { done: 'Saran diabaikan.' };
		} catch (e) {
			return failure(e);
		}
	},

	/** "Minta saran AI": asks now, for one plan or one client, even when nothing changed */
	askAi: async (event: RequestEvent) => {
		requireUser(event.locals);
		if (!aiEnabled()) return fail(400, { error: 'AI belum diatur di server (SUMOPOD_API_KEY).' });
		const form = await event.request.formData();
		const planId = id.safeParse(form.get('planId'));
		const clientIdIn = id.safeParse(form.get('clientId'));
		let clientId = clientIdIn.success ? clientIdIn.data : null;
		if (planId.success) {
			const [plan] = await db
				.select({ clientId: strategyPlan.clientId })
				.from(strategyPlan)
				.where(eq(strategyPlan.id, planId.data));
			if (!plan) return fail(400, { error: 'Rencana tidak ditemukan.' });
			clientId = plan.clientId;
		}
		if (!clientId) return fail(400, { error: 'Pilih klien atau rencana.' });
		try {
			// Bring the long memory up to date first (no AI call when the history is unchanged)
			try {
				await refreshClientContext(db, clientId, { complete: aiComplete() });
			} catch (e) {
				if (!(e instanceof ServiceError)) console.error('context refresh failed', e);
			}
			const r = await generateSuggestions(db, clientId, {
				complete: aiComplete(),
				force: true,
				planId: planId.success ? planId.data : undefined
			});
			const count = r.status === 'created' ? r.count : 0;
			return {
				done: count ? `${count} saran AI baru.` : 'AI tidak menemukan saran baru untuk saat ini.'
			};
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			console.error('askAi failed', e);
			return fail(502, { error: 'AI sedang tidak bisa dihubungi. Coba lagi sebentar lagi.' });
		}
	},

	/** "Perbarui dengan AI" on the Ringkasan konteks card: always asks the AI */
	refreshContext: async (event: RequestEvent) => {
		requireUser(event.locals);
		if (!aiEnabled()) return fail(400, { error: 'AI belum diatur di server (SUMOPOD_API_KEY).' });
		const clientId = id.safeParse((await event.request.formData()).get('clientId'));
		if (!clientId.success) return fail(400, { error: 'Klien tidak valid.' });
		try {
			const r = await refreshClientContext(db, clientId.data, {
				complete: aiComplete(),
				force: true
			});
			if (r.status === 'empty')
				return fail(400, {
					error: 'Belum ada riwayat untuk diringkas. Catat deal atau aktivitas dulu.'
				});
			return { done: 'Ringkasan konteks diperbarui.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			console.error('refreshContext failed', e);
			return fail(502, { error: 'AI sedang tidak bisa dihubungi. Coba lagi sebentar lagi.' });
		}
	},

	/** The team's edit of the Ringkasan konteks */
	saveContext: async (event: RequestEvent) => {
		const user = requireUser(event.locals);
		const form = await event.request.formData();
		const clientId = id.safeParse(form.get('clientId'));
		if (!clientId.success) return fail(400, { error: 'Klien tidak valid.' });
		try {
			await saveClientContext(db, clientId.data, String(form.get('summary') ?? ''), user.id);
			return { done: 'Ringkasan konteks disimpan.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
