import { fail } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { CLIENT_STATUSES, INDUSTRIES } from '#lib/constants.ts';
import { clientSchema } from '#lib/schemas/client.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction, saveClientForm } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import {
	archiveClient,
	CLIENT_SORTS,
	listClients,
	listOwners,
	deleteClient,
	restoreClient
} from '#lib/server/services/clients.ts';
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
	save: async ({ request, locals }) => saveClientForm(request, requireUser(locals).id),

	archive: async ({ request, locals }) => {
		const user = requireUser(locals);
		const id = idSchema.safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Klien tidak valid.' });
		return runSimpleAction(() => archiveClient(db, id.data, user.id), 'Klien diarsipkan.');
	},

	restore: async ({ request, locals }) => {
		const user = requireUser(locals);
		const id = idSchema.safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Klien tidak valid.' });
		return runSimpleAction(
			() => restoreClient(db, id.data, user.id),
			'Klien dipulihkan dari arsip.'
		);
	},

	/** Archived clients only, after the confirmation dialog; refused while money records exist */
	delete: async ({ request, locals }) => {
		requireUser(locals);
		const id = idSchema.safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Klien tidak valid.' });
		return runSimpleAction(() => deleteClient(db, id.data), 'Klien dihapus permanen.');
	}
};
