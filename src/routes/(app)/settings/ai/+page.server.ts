import { fail } from '@sveltejs/kit';
import { nextRun } from '#lib/ai-schedule.ts';
import { aiSettingsSchema } from '#lib/schemas/settings.ts';
import { aiEnabled } from '#lib/server/ai-config.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireRole } from '#lib/server/guards.ts';
import { getAiSettings, saveAiSettings } from '#lib/server/services/ai-settings.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	const settings = await getAiSettings(db);
	return { settings, next: nextRun(settings), keySet: aiEnabled() };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const user = requireRole(locals, 'admin');
		const parsed = aiSettingsSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		return runSimpleAction(
			() => saveAiSettings(db, parsed.data, user.id),
			parsed.data.enabled ? 'Pengaturan Saran AI disimpan.' : 'Saran AI dimatikan.'
		);
	}
};
