// Form-action helpers shared by several routes: validate with Superforms, call a service,
// and turn ServiceError into an inline error or a status message.
import { fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { clientSchema, type ClientInput } from '#lib/schemas/client.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { db } from '#lib/server/db/index.ts';
import { createClient, updateClient } from '#lib/server/services/clients.ts';
import { ServiceError } from '#lib/server/services/errors.ts';

/** `save` action of the client drawer (Klien list and Detail Klien) */
export async function saveClientForm(request: Request, userId: string) {
	const form = await superValidate<ClientInput, FormMessage>(request, zod4(clientSchema));
	if (!form.valid) return fail(400, { form });

	try {
		const row = form.data.id
			? await updateClient(db, form.data.id, form.data, userId)
			: await createClient(db, form.data, userId);
		return message(form, {
			type: 'success',
			text: form.data.id ? `Data ${row.name} disimpan.` : `Klien ${row.name} ditambahkan.`
		});
	} catch (e) {
		if (!(e instanceof ServiceError)) throw e;
		if (e.field === 'ownerId') return setError(form, 'ownerId', e.message);
		return message(form, { type: 'error', text: e.message }, { status: 400 });
	}
}

/** Run a service call for a simple `{ id }` form and report `{ done }` or `{ error }` */
export async function runSimpleAction(work: () => Promise<unknown>, done: string) {
	try {
		await work();
		return { done };
	} catch (e) {
		if (e instanceof ServiceError) return fail(400, { error: e.message });
		throw e;
	}
}
