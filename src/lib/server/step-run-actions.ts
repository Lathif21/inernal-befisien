// "Jalankan" on a system-action step (P2-13), mounted on Strategi and Detail Klien. The modal asks
// `prepareStep` for the pre-filled run, then posts it to `runStep` as JSON; services/step-runs.ts
// checks it again and writes it with the step's completion.
import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import { executeStepRun, prepareStepRun } from '#lib/server/services/step-runs.ts';

export const stepRunActions = {
	/** The run pre-filled from the step's plan and today's data */
	prepareStep: async ({ request, locals }: RequestEvent) => {
		requireUser(locals);
		const stepId = z.uuid().safeParse((await request.formData()).get('stepId'));
		if (!stepId.success) return fail(400, { error: 'Langkah tidak valid.' });
		try {
			return { prepared: await prepareStepRun(db, stepId.data) };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	runStep: async ({ request, locals }: RequestEvent) => {
		const user = requireUser(locals);
		const form = await request.formData();
		const stepId = z.uuid().safeParse(form.get('stepId'));
		if (!stepId.success) return fail(400, { error: 'Langkah tidak valid.' });
		let run: unknown;
		try {
			run = JSON.parse(String(form.get('run') ?? ''));
		} catch {
			return fail(400, { error: 'Data aksi tidak valid.' });
		}
		try {
			const { line } = await executeStepRun(db, stepId.data, run, user.id);
			return { done: `${line} Langkahnya ditandai selesai.` };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message, field: e.field ?? '' });
			throw e;
		}
	}
};
