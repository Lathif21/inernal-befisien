import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { planStepsPage } from '#lib/server/services/plans.ts';
import type { RequestHandler } from './$types';

/** One page (4) of a plan's steps, for the small pager on a plan card */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) error(401, 'Silakan masuk dulu.');
	const id = z.uuid().safeParse(params.id);
	if (!id.success) error(404, 'Rencana tidak ditemukan.');
	const page = z.coerce
		.number()
		.int()
		.min(1)
		.max(1000)
		.catch(1)
		.parse(url.searchParams.get('page'));
	return json(await planStepsPage(db, id.data, page));
};
