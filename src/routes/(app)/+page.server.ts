import { z } from 'zod';
import { dateID, nowWib } from '#lib/format.ts';
import { bucketLabel, bucketStart, bucketTitle, resolvePeriod } from '#lib/period.ts';
import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { attentionSteps } from '#lib/server/services/plans.ts';
import {
	clientTotals,
	dashboardKpis,
	pipelineSummary,
	timeSeries,
	topClientsByProfit,
	topClientsSeries
} from '#lib/server/services/reports.ts';
import type { PageServerLoad } from './$types';

const params = z.object({
	view: z.enum(['waktu', 'klien']).catch('waktu')
});

/** "Selamat pagi" … by the hour in WIB */
function greeting(hour: number) {
	if (hour < 11) return 'Selamat pagi';
	if (hour < 15) return 'Selamat siang';
	if (hour < 18) return 'Selamat sore';
	return 'Selamat malam';
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const user = requireUser(locals);
	const { view } = params.parse(Object.fromEntries(url.searchParams));
	// The Dashboard defaults to Bulanan
	const period = resolvePeriod(
		{
			period: url.searchParams.get('period'),
			from: url.searchParams.get('from'),
			to: url.searchParams.get('to')
		},
		{ defaultPeriod: 'month' }
	);

	// One round of parallel queries; the time series only when that view is shown
	const [kpis, clients, series, attention, pipeline] = await Promise.all([
		dashboardKpis(db, period),
		clientTotals(db, period),
		view === 'waktu' ? timeSeries(db, period) : Promise.resolve(null),
		attentionSteps(db, { mineOf: user.id }).limit(6),
		pipelineSummary(db)
	]);

	const current = bucketStart(period.from, period.bucket);
	const chart = series
		? {
				groups: series.map((s) => ({
					key: s.key,
					label: bucketLabel(s.key, period.bucket),
					title: bucketTitle(s.key, period.bucket),
					income: s.income,
					expense: s.expense,
					current: period.period !== 'custom' && s.key === current
				})),
				bucket: period.bucket
			}
		: (() => {
				const { series: top, others } = topClientsSeries(clients);
				return {
					groups: top.map((t) => ({
						key: t.key,
						label: t.label,
						title: t.name,
						income: t.income,
						expense: t.expense
					})),
					others
				};
			})();

	const now = nowWib();
	return {
		period,
		view,
		kpis,
		chart,
		attention,
		pipeline,
		topClients: topClientsByProfit(clients),
		greeting: {
			text: `${greeting(now.getHours())}, ${user.name.split(' ')[0]}`,
			date: dateID(now, 'long')
		}
	};
};
