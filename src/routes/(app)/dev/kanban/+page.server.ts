import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import type { PageServerLoad } from './$types';

// Demo board for the generic Kanban component (P1-05). Development only.
export const load: PageServerLoad = () => {
	if (!dev) error(404, 'Halaman tidak ditemukan.');
};
