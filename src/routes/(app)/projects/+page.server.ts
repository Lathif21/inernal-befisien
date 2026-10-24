import { fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { SERVICE_TYPES } from '#lib/constants.ts';
import { nextActionState } from '#lib/next-action.ts';
import type { FormMessage } from '#lib/schemas/message.ts';
import { projectMoveSchema, projectSchema, type ProjectInput } from '#lib/schemas/project.ts';
import { db } from '#lib/server/db/index.ts';
import { runSimpleAction } from '#lib/server/forms.ts';
import { requireUser } from '#lib/server/guards.ts';
import { stepActions } from '#lib/server/step-actions.ts';
import { listOwners } from '#lib/server/services/clients.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import {
	deleteProject,
	getProjectDetail,
	listBoardProjects,
	moveProject,
	updateProject
} from '#lib/server/services/projects.ts';
import type { Actions, PageServerLoad } from './$types';

const boardParams = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	owner: z.string().max(64).optional().catch(undefined),
	service: z.enum(SERVICE_TYPES).optional().catch(undefined),
	late: z.literal('1').optional().catch(undefined),
	project: z.uuid().optional().catch(undefined)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	requireUser(locals);
	const params = boardParams.parse(Object.fromEntries(url.searchParams));

	const [projects, owners, projectForm, detail] = await Promise.all([
		listBoardProjects(db, {
			q: params.q || undefined,
			ownerId: params.owner || undefined,
			serviceType: params.service
		}),
		listOwners(db),
		superValidate(zod4(projectSchema)),
		params.project ? getProjectDetail(db, params.project) : Promise.resolve(null)
	]);

	const now = new Date();
	const isLate = (p: (typeof projects)[number]) =>
		!!p.next && p.stage !== 'done' && nextActionState(p.next.dueAt, now, p.next.allDay) === 'late';
	const lateCount = projects.filter(isLate).length;

	return {
		projects: params.late ? projects.filter(isLate) : projects,
		lateCount,
		owners,
		projectForm,
		detail,
		params
	};
};

export const actions: Actions = {
	...stepActions,
	saveProject: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate<ProjectInput, FormMessage>(request, zod4(projectSchema));
		if (!form.valid) return fail(400, { form });
		try {
			const row = await updateProject(db, form.data, user.id);
			return message(form, { type: 'success', text: `Proyek "${row.name}" disimpan.` });
		} catch (e) {
			if (!(e instanceof ServiceError)) throw e;
			if (e.field === 'ownerId') return setError(form, e.field, e.message);
			return message(form, { type: 'error', text: e.message }, { status: 400 });
		}
	},

	/** "Hapus proyek" in the project drawer (ConfirmDialog) */
	deleteProject: async ({ request, locals }) => {
		const user = requireUser(locals);
		const id = z.uuid().safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { error: 'Proyek tidak valid.' });
		return runSimpleAction(() => deleteProject(db, id.data, user.id), 'Proyek dihapus.');
	},

	/** Board move (drag or "Pindah ke…") */
	move: async ({ request, locals }) => {
		const user = requireUser(locals);
		const move = projectMoveSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!move.success) return fail(400, { error: 'Data perpindahan tidak lengkap.' });
		try {
			await moveProject(db, move.data, user.id);
			return { done: 'Proyek dipindahkan.' };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
