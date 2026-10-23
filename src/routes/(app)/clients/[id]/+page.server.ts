import { error, fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { noteSchema, type NoteInput } from '#lib/schemas/activity.ts';
import { clientSchema } from '#lib/schemas/client.ts';
import { contactSchema, type ContactInput } from '#lib/schemas/contact.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction, saveClientForm } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { addNote, listActivities } from '#lib/server/services/activity.ts';
import {
	getClient,
	listClientDeals,
	listClientProjects,
	listOwners
} from '#lib/server/services/clients.ts';
import {
	deleteContact,
	listContacts,
	saveContact,
	setPrimaryContact
} from '#lib/server/services/contacts.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import type { Actions, PageServerLoad } from './$types';

const CLIENT_TABS = ['ringkasan', 'kontak', 'deal', 'aktivitas'] as const;

const pageParams = z.object({
	tab: z.enum(CLIENT_TABS).catch('ringkasan'),
	page: z.coerce.number().int().min(1).max(10_000).catch(1)
});

function clientIdOr404(raw: string) {
	const id = z.uuid().safeParse(raw);
	if (!id.success) error(404, 'Klien tidak ditemukan.');
	return id.data;
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	requireUser(locals);
	const id = clientIdOr404(params.id);
	const { tab, page } = pageParams.parse(Object.fromEntries(url.searchParams));

	const [client, contacts, deals, projects, activities, owners, clientForm, contactForm, noteForm] =
		await Promise.all([
			getClient(db, id),
			listContacts(db, id),
			listClientDeals(db, id),
			listClientProjects(db, id),
			// Ringkasan shows the latest 5; Aktivitas pages through 20 at a time
			listActivities(db, id, tab === 'aktivitas' ? { page } : { page: 1, pageSize: 5 }),
			listOwners(db),
			superValidate(zod4(clientSchema)),
			superValidate(zod4(contactSchema)),
			superValidate(zod4(noteSchema))
		]);
	if (!client) error(404, 'Klien tidak ditemukan.');

	return {
		client,
		contacts,
		deals,
		projects,
		activities,
		owners,
		tab,
		clientForm,
		contactForm,
		noteForm
	};
};

const contactIdSchema = z.uuid();

export const actions: Actions = {
	save: async ({ request, locals }) => saveClientForm(request, requireUser(locals).id),

	saveContact: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const clientId = clientIdOr404(params.id);
		const form = await superValidate<ContactInput, FormMessage>(request, zod4(contactSchema));
		if (!form.valid) return fail(400, { form });
		try {
			const row = await saveContact(db, clientId, form.data, user.id);
			return message(form, {
				type: 'success',
				text: form.data.id ? `Kontak ${row.name} disimpan.` : `Kontak ${row.name} ditambahkan.`
			});
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'isPrimary') return setError(form, 'isPrimary', e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	setPrimary: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const clientId = clientIdOr404(params.id);
		const id = contactIdSchema.safeParse((await request.formData()).get('contactId'));
		if (!id.success) return fail(400, { error: 'Kontak tidak valid.' });
		return runSimpleAction(
			() => setPrimaryContact(db, clientId, id.data, user.id),
			'Kontak utama diperbarui.'
		);
	},

	deleteContact: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const clientId = clientIdOr404(params.id);
		const id = contactIdSchema.safeParse((await request.formData()).get('contactId'));
		if (!id.success) return fail(400, { error: 'Kontak tidak valid.' });
		return runSimpleAction(() => deleteContact(db, clientId, id.data, user.id), 'Kontak dihapus.');
	},

	addNote: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const clientId = clientIdOr404(params.id);
		const form = await superValidate<NoteInput, FormMessage>(request, zod4(noteSchema));
		if (!form.valid) return fail(400, { form });
		try {
			await addNote(db, clientId, form.data, user.id);
			return message(form, { type: 'success', text: 'Aktivitas dicatat.' });
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	}
};
