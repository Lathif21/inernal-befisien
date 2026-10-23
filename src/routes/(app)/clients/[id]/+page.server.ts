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
import { TXN_TYPES } from '#lib/constants.ts';
import { resolvePeriod } from '#lib/period.ts';
import { transactionSchema } from '#lib/schemas/transaction.ts';
import { getNextActions } from '#lib/server/services/actions.ts';
import {
	financeTotals,
	listCategories,
	listTransactions
} from '#lib/server/services/transactions.ts';
import { transactionActions } from '#lib/server/transaction-actions.ts';
import type { Actions, PageServerLoad } from './$types';

const CLIENT_TABS = ['ringkasan', 'kontak', 'deal', 'keuangan', 'aktivitas'] as const;

const pageParams = z.object({
	tab: z.enum(CLIENT_TABS).catch('ringkasan'),
	page: z.coerce.number().int().min(1).max(10_000).catch(1),
	/** Keuangan tab filters (with the period params) */
	q: z.string().trim().max(100).optional().catch(undefined),
	type: z.enum(TXN_TYPES).optional().catch(undefined)
});

function clientIdOr404(raw: string) {
	const id = z.uuid().safeParse(raw);
	if (!id.success) error(404, 'Klien tidak ditemukan.');
	return id.data;
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	requireUser(locals);
	const id = clientIdOr404(params.id);
	const { tab, page, q, type } = pageParams.parse(Object.fromEntries(url.searchParams));
	// The client's transactions default to Tahunan (docs/design-system/components/PeriodFilter)
	const period = resolvePeriod(
		{
			period: url.searchParams.get('period'),
			from: url.searchParams.get('from'),
			to: url.searchParams.get('to')
		},
		{ defaultPeriod: 'year' }
	);
	const finance = tab === 'keuangan';

	const [
		client,
		contacts,
		deals,
		projects,
		activities,
		owners,
		totals,
		clientForm,
		contactForm,
		noteForm
	] = await Promise.all([
		getClient(db, id),
		listContacts(db, id),
		listClientDeals(db, id),
		listClientProjects(db, id),
		// Ringkasan shows the latest 5; Aktivitas pages through 20 at a time
		listActivities(db, id, tab === 'aktivitas' ? { page } : { page: 1, pageSize: 5 }),
		listOwners(db),
		// Finance strip: all time, paid only (+ planned income)
		financeTotals(db, { clientId: id }),
		superValidate(zod4(clientSchema)),
		superValidate(zod4(contactSchema)),
		superValidate(zod4(noteSchema))
	]);
	if (!client) error(404, 'Klien tidak ditemukan.');

	const active = projects.filter((p) => p.stage !== 'done');
	const [nextActions, transactions, categories, txnForm] = await Promise.all([
		getNextActions(db, { projectIds: active.map((p) => p.id) }),
		finance
			? listTransactions(
					db,
					{ clientId: id, q: q || undefined, type, from: period.from, to: period.to },
					{ page }
				)
			: Promise.resolve(null),
		finance ? listCategories(db) : Promise.resolve([]),
		finance ? superValidate(zod4(transactionSchema)) : Promise.resolve(null)
	]);

	return {
		client,
		contacts,
		deals,
		projects,
		activeProjects: active.map((p) => ({ ...p, next: nextActions.get(p.id) ?? null })),
		activities,
		owners,
		totals,
		tab,
		finance:
			transactions && txnForm ? { transactions, categories, txnForm, period, q, type } : null,
		clientForm,
		contactForm,
		noteForm
	};
};

const contactIdSchema = z.uuid();

export const actions: Actions = {
	...transactionActions,
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
