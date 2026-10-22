import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '#lib/server/auth.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { email, message: 'Email dan kata sandi wajib diisi.' });
		}

		try {
			// sveltekitCookies sets the session cookie on this response
			await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
		} catch (e) {
			if (e instanceof APIError) {
				const message =
					e.status === 'TOO_MANY_REQUESTS'
						? 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.'
						: 'Email atau kata sandi salah.';
				return fail(400, { email, message });
			}
			throw e;
		}

		redirect(303, '/');
	}
};
