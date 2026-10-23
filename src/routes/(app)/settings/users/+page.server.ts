import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { newUserSchema, resetPasswordSchema } from '#lib/schemas/settings.ts';
import { db } from '#lib/server/db/index.ts';
import { requireRole } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import { createUser, listUsers, resetPassword, setUserDigest } from '#lib/server/services/users.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireRole(locals, 'admin');
	return { users: await listUsers(db), meId: me.id };
};

/** First Zod message per field */
function fieldErrors(issues: z.core.$ZodIssue[]) {
	const out: Record<string, string> = {};
	for (const i of issues) out[String(i.path[0])] ??= i.message;
	return out;
}

export const actions: Actions = {
	/** Returns the password once when it was generated */
	addUser: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const parsed = newUserSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { fields: fieldErrors(parsed.error.issues) });
		try {
			const made = await createUser(db, parsed.data);
			return {
				done: `Pengguna ${parsed.data.name} ditambahkan.`,
				credentials: made.generated
					? { name: parsed.data.name, email: made.email, password: made.password }
					: null
			};
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			return fail(400, { fields: { [e.field ?? 'email']: e.message } });
		}
	},

	resetPassword: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const parsed = resetPasswordSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { fields: fieldErrors(parsed.error.issues) });
		try {
			const r = await resetPassword(db, parsed.data.userId, parsed.data.password || undefined);
			return {
				done: `Kata sandi ${r.name} diganti. Sesi lamanya sudah keluar.`,
				credentials: r.generated ? { name: r.name, email: '', password: r.password } : null
			};
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	setDigest: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const enabled = form.get('enabled') === 'true';
		try {
			await setUserDigest(db, userId, enabled);
			return { done: enabled ? 'Ringkasan harian dinyalakan.' : 'Ringkasan harian dimatikan.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
