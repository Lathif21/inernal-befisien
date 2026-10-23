import { templateCsv } from '#lib/import/client-csv.ts';
import { requireUser } from '#lib/server/guards.ts';
import type { RequestHandler } from './$types';

/** The import template: header plus one example row that imports as is */
export const GET: RequestHandler = ({ locals }) => {
	requireUser(locals);
	return new Response(templateCsv(), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': 'attachment; filename="import-template.csv"'
		}
	});
};
