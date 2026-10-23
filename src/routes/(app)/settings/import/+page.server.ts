import { fail } from '@sveltejs/kit';
import { MAX_IMPORT_BYTES } from '#lib/import/client-csv.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { ServiceError } from '#lib/server/services/errors.ts';
import { previewImport, runImport } from '#lib/server/services/import.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals);
	return {};
};

const TOO_BIG = `File terlalu besar (maks. ${MAX_IMPORT_BYTES / 1_000_000} MB).`;

export const actions: Actions = {
	/** Step 1: read the uploaded file and show what would happen, row by row */
	preview: async ({ request, locals }) => {
		requireUser(locals);
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { error: 'Pilih file CSV terlebih dahulu.' });
		if (file.size > MAX_IMPORT_BYTES) return fail(400, { error: TOO_BIG });
		if (!/\.csv$/i.test(file.name))
			return fail(400, {
				error: 'File harus berformat .csv (simpan dari Excel sebagai CSV UTF-8).'
			});
		const text = await file.text();
		const preview = await previewImport(db, text);
		return { fileName: file.name, text, preview };
	},

	/** Step 2: import the same text; the server checks every row again */
	import: async ({ request, locals }) => {
		const user = requireUser(locals);
		const text = (await request.formData()).get('text');
		if (typeof text !== 'string' || !text.trim())
			return fail(400, { error: 'Data impor hilang. Unggah ulang filenya.' });
		if (text.length > MAX_IMPORT_BYTES) return fail(400, { error: TOO_BIG });
		try {
			const summary = await runImport(db, text, user.id);
			return { summary };
		} catch (e) {
			if (e instanceof ServiceError) return fail(400, { error: e.message });
			console.error('import failed', e);
			return fail(500, { error: 'Impor gagal. Tidak ada data yang disimpan. Coba lagi.' });
		}
	}
};
