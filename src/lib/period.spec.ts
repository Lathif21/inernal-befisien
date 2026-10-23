import { describe, expect, it } from 'vitest';
import { daysBetween, isDay, rangeLabel, resolvePeriod } from './period';

const today = '2026-10-22'; // Kamis
const r = (params: Record<string, string>, defaultPeriod?: Parameters<typeof resolvePeriod>[1]) =>
	resolvePeriod(params, { today, ...defaultPeriod });

describe('resolvePeriod', () => {
	it('Bulanan: whole calendar month, previous month, label from the spec', () => {
		const p = r({ period: 'month', from: '2026-10-01' });
		expect(p).toMatchObject({
			from: '2026-10-01',
			to: '2026-10-31',
			prevFrom: '2026-09-01',
			prevTo: '2026-09-30',
			label: '1 – 31 Okt 2026',
			bucket: 'month',
			seriesFrom: '2026-05-01',
			days: 31,
			nextInFuture: true
		});
	});

	it('Mingguan: Monday to Sunday, from any day in the week', () => {
		const p = r({ period: 'week', from: '2026-10-22' });
		expect(p).toMatchObject({ from: '2026-10-19', to: '2026-10-25', label: '19 – 25 Okt 2026' });
		expect(p).toMatchObject({
			prevFrom: '2026-10-12',
			prevTo: '2026-10-18',
			prevAnchor: '2026-10-12'
		});
		// a Sunday belongs to the week that started the Monday before
		expect(r({ period: 'week', from: '2026-10-25' }).from).toBe('2026-10-19');
		// across months and years
		expect(r({ period: 'week', from: '2026-10-01' }).label).toBe('28 Sep – 4 Okt 2026');
		expect(r({ period: 'week', from: '2026-12-31' }).label).toBe('28 Des 2026 – 3 Jan 2027');
	});

	it('Harian: one day, last 14 days for the chart', () => {
		const p = r({ period: 'day', from: '2026-03-01' });
		expect(p).toMatchObject({
			from: '2026-03-01',
			to: '2026-03-01',
			prevFrom: '2026-02-28',
			prevTo: '2026-02-28',
			label: '1 Mar 2026',
			seriesFrom: '2026-02-16',
			nextInFuture: false
		});
	});

	it('Tahunan: calendar year with "Tahun 2026"', () => {
		const p = r({ period: 'year', from: '2026-06-15' });
		expect(p).toMatchObject({
			from: '2026-01-01',
			to: '2026-12-31',
			prevFrom: '2025-01-01',
			prevTo: '2025-12-31',
			label: 'Tahun 2026',
			bucket: 'year',
			seriesFrom: '2024-01-01'
		});
	});

	it('Custom: inclusive range, previous range of the same length, automatic bucket', () => {
		const p = r({ period: 'custom', from: '2026-10-10', to: '2026-10-20' });
		expect(p).toMatchObject({
			days: 11,
			prevFrom: '2026-09-29',
			prevTo: '2026-10-09',
			bucket: 'day'
		});
		expect(r({ period: 'custom', from: '2026-10-20', to: '2026-10-10' }).from).toBe('2026-10-10'); // swapped
		expect(r({ period: 'custom', from: '2026-01-01', to: '2026-04-30' }).bucket).toBe('week');
		expect(r({ period: 'custom', from: '2025-01-01', to: '2026-01-01' }).bucket).toBe('month');
		expect(r({ period: 'custom', from: '2020-01-01', to: '2026-01-01' }).days).toBe(3 * 366); // capped
	});

	it('falls back to the default period and today on bad input', () => {
		expect(r({ period: 'decade', from: '2026-02-31' }, { defaultPeriod: 'week' })).toMatchObject({
			period: 'week',
			from: '2026-10-19'
		});
		expect(r({})).toMatchObject({ period: 'month', from: '2026-10-01' });
	});

	it('gives WIB instants for timestamptz queries, end exclusive', () => {
		const p = r({ period: 'day', from: '2026-10-22' });
		expect(p.fromInstant.toISOString()).toBe('2026-10-21T17:00:00.000Z');
		expect(p.toInstant.toISOString()).toBe('2026-10-22T17:00:00.000Z');
	});

	it('disables "next" only when the next period starts after today', () => {
		expect(r({ period: 'month', from: '2026-09-01' }).nextInFuture).toBe(false);
		expect(r({ period: 'week', from: '2026-10-22' }).nextInFuture).toBe(true);
		expect(r({ period: 'day', from: '2026-10-21' }).nextInFuture).toBe(false);
		expect(r({ period: 'day', from: '2026-10-22' }).nextInFuture).toBe(true);
	});
});

describe('calendar helpers', () => {
	it('validates days and counts inclusively', () => {
		expect(isDay('2028-02-29')).toBe(true);
		expect(isDay('2026-02-29')).toBe(false);
		expect(isDay('22-10-2026')).toBe(false);
		expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
		expect(rangeLabel('2026-10-22', '2026-10-22')).toBe('22 Okt 2026');
	});
});
