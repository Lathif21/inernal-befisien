import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { categorySchema } from '#lib/schemas/settings.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireRole } from '#lib/server/guards.ts';
import {
	deleteCategory,
	listCategoriesWithUsage,
	moveCategory,
	saveCategory
} from '#lib/server/services/categories.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	return { categories: await listCategoriesWithUsage(db) };
};

const id = z.uuid();

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const parsed = categorySchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		return runSimpleAction(
			() => saveCategory(db, parsed.data),
			parsed.data.id ? 'Kategori diganti namanya.' : `Kategori "${parsed.data.name}" ditambahkan.`
		);
	},

	delete: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const parsed = id.safeParse((await request.formData()).get('id'));
		if (!parsed.success) return fail(400, { error: 'Kategori tidak valid.' });
		return runSimpleAction(() => deleteCategory(db, parsed.data), 'Kategori dihapus.');
	},

	move: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const form = await request.formData();
		const parsed = id.safeParse(form.get('id'));
		const direction = form.get('direction') === 'up' ? 'up' : 'down';
		if (!parsed.success) return fail(400, { error: 'Kategori tidak valid.' });
		return runSimpleAction(() => moveCategory(db, parsed.data, direction), 'Urutan diperbarui.');
	}
};
