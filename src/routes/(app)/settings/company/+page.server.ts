import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { npwpDisplay, phoneDisplay } from '#lib/format.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { companySchema, type CompanyInput } from '#lib/schemas/settings.ts';
import { db } from '#lib/server/db/index.ts';
import { requireRole } from '#lib/server/guards.ts';
import { getCompanyProfile, saveCompanyProfile } from '#lib/server/services/company.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	const { isExample, ...c } = await getCompanyProfile(db);
	const form = await superValidate<CompanyInput, FormMessage>(
		{
			...c,
			phone: c.phone ? phoneDisplay(c.phone) : '',
			email: c.email ?? '',
			npwp: c.npwp ? npwpDisplay(c.npwp) : ''
		},
		zod4(companySchema),
		{ errors: false }
	);
	return { form, isExample };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const user = requireRole(locals, 'admin');
		const form = await superValidate<CompanyInput, FormMessage>(request, zod4(companySchema));
		if (!form.valid) return fail(400, { form });
		await saveCompanyProfile(db, form.data, user.id);
		return message(form, { type: 'success', text: 'Profil perusahaan disimpan.' });
	}
};
