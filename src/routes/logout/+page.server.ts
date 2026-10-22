import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/server/auth.ts';
import type { Actions, PageServerLoad } from './$types';

// Logout is POST-only (a form in the app shell); a GET just goes home
export const load: PageServerLoad = () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (locals.session) await auth.api.signOut({ headers: request.headers });
		redirect(303, '/login');
	}
};
