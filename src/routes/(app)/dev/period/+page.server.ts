import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import { resolvePeriod } from '#lib/period.ts';
import type { PageServerLoad } from './$types';

// Demo for the shared period filter (P1-07b). Development only.
export const load: PageServerLoad = ({ url }) => {
	if (!dev) error(404, 'Halaman tidak ditemukan.');
	const period = resolvePeriod(
		{
			period: url.searchParams.get('period'),
			from: url.searchParams.get('from'),
			to: url.searchParams.get('to')
		},
		{ defaultPeriod: 'month' }
	);
	return { period, other: url.searchParams.get('q') ?? '' };
};
