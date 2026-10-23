import { fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { CLIENT_STATUSES, INDUSTRIES } from '#lib/constants.ts';
import { clientSchema } from '#lib/schemas/client.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import {
	archiveClient,
	CLIENT_SORTS,
	createClient,
	listClients,
	listOwners,
	restoreClient,
	updateClient
} from '#lib/server/services/clients.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import type { Actions, PageServerLoad } from './$types';

/** URL params; anything invalid falls back to the default instead of erroring */
const listParams = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	status: z.enum(CLIENT_STATUSES).optional().catch(undefined),
	industry: z.enum(INDUSTRIES).optional().catch(undefined),
	owner: z.string().max(64).optional().catch(undefined),
	sort: z.enum(CLIENT_SORTS).optional().catch(undefined),
	dir: z.enum(['asc', 'desc']).optional().catch(undefined),
	page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined)
});

export type ClientMessage = { type: 'success' | 'error'; text: string };

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const params = listParams.parse(Object.fromEntries(url.searchParams));

	const [list, owners, form] = await Promise.all([
		listClients(db, { ...params, q: params.q || undefined, ownerId: params.owner || undefined }),
		listOwners(db),
		superValidate(zod4(clientSchema))
	]);

	return { list, owners, form, params };
};

const idSchema = z.uuid();

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate<z.infer<typeof clientSchema>, ClientMessage>(
			request,
			zod4(clientSchema)
		);
		if (!form.valid) return fail(400, { form });

		try {
			const row = form.data.id
				? await updateClient(db, form.data.id, form.data, user.id)
				: await createClient(db, form.data, user.id);
			return message(form, {
				type: 'success',
				text: form.data.id ? `Data ${row.name} disimpan.` : `Klien ${row.name} ditambahkan.`
			});
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'ownerId') return setError(form, 'ownerId', e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	archive: async ({ request, locals }) => {
		const user = requireUser(locals);
		const id = idSchema.safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Klien tidak valid.' });
		try {
			await archiveClient(db, id.data, user.id);
			return { done: 'Klien diarsipkan.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	restore: async ({ request, locals }) => {
		const user = requireUser(locals);
		const id = idSchema.safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Klien tidak valid.' });
		try {
			await restoreClient(db, id.data, user.id);
			return { done: 'Klien dipulihkan dari arsip.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
