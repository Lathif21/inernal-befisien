// The one period helper (docs/03-SCREENS.md "Shared: period filter"). WIB calendar, weeks Monday–Sunday.
// Works on calendar days (`yyyy-MM-dd`) with UTC arithmetic, so no machine time zone can shift a day.
import { dayKeyWib, wibLocalToDate } from './format';

export const PERIODS = ['day', 'week', 'month', 'year', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export type Bucket = 'day' | 'week' | 'month' | 'year';

export const PERIOD_LABELS: Record<Period, string> = {
	day: 'Harian',
	week: 'Mingguan',
	month: 'Bulanan',
	year: 'Tahunan',
	custom: 'Custom'
};

/** URL params: ?period=month&from=2026-10-01 (custom adds &to=…) */
export type PeriodParams = { period?: string | null; from?: string | null; to?: string | null };

export type ResolvedPeriod = {
	period: Period;
	/** First and last calendar day, inclusive (WIB) */
	from: string;
	to: string;
	/** The previous period of the same length, for "vs periode sebelumnya" */
	prevFrom: string;
	prevTo: string;
	/** Anchors for the prev / next arrows */
	prevAnchor: string;
	nextAnchor: string;
	/** Next starts after today (WIB): the arrow is disabled */
	nextInFuture: boolean;
	/** Chart bucket and the first day of the chart range (last 14 days / 8 weeks / 6 months / 3 years) */
	bucket: Bucket;
	seriesFrom: string;
	/** Instants for timestamptz queries: [fromInstant, toInstant) in WIB */
	fromInstant: Date;
	toInstant: Date;
	/** "1 – 31 Okt 2026", "19 – 25 Okt 2026", "Tahun 2026" */
	label: string;
	days: number;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------- calendar-day arithmetic ----------
function toUtc(day: string) {
	const [y, m, d] = day.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}
function fromUtc(ms: number) {
	return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(day: string, n: number) {
	return fromUtc(toUtc(day) + n * 86_400_000);
}
function addMonths(day: string, n: number) {
	const [y, m] = day.split('-').map(Number);
	return fromUtc(Date.UTC(y, m - 1 + n, 1));
}
function monthStart(day: string) {
	return `${day.slice(0, 7)}-01`;
}
function monthEnd(day: string) {
	const [y, m] = day.split('-').map(Number);
	return fromUtc(Date.UTC(y, m, 0));
}
function weekStart(day: string) {
	const dow = new Date(toUtc(day)).getUTCDay(); // 0 = Sunday
	return addDays(day, -((dow + 6) % 7));
}
export function daysBetween(from: string, to: string) {
	return Math.round((toUtc(to) - toUtc(from)) / 86_400_000) + 1;
}
/** A real calendar day (rejects 2026-02-31) */
export function isDay(v: unknown): v is string {
	return typeof v === 'string' && DAY.test(v) && fromUtc(toUtc(v)) === v;
}

function fmt(day: string, withYear: boolean) {
	const [y, m, d] = day.split('-').map(Number);
	return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}
/** "19 – 25 Okt 2026", "28 Sep – 4 Okt 2026", "29 Des 2026 – 4 Jan 2027", "22 Okt 2026" */
export function rangeLabel(from: string, to: string) {
	if (from === to) return fmt(from, true);
	const sameYear = from.slice(0, 4) === to.slice(0, 4);
	const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
	if (sameMonth) return `${Number(from.slice(8))} – ${fmt(to, true)}`;
	return `${fmt(from, !sameYear)} – ${fmt(to, true)}`;
}

/** Custom ranges longer than this are cut (keeps queries and charts sane) */
const MAX_CUSTOM_DAYS = 3 * 366;

/**
 * Resolve URL params into a period. Invalid or missing values fall back to `defaultPeriod`
 * anchored on today (WIB). `from` is the anchor: any day inside the period.
 */
export function resolvePeriod(
	params: PeriodParams,
	{ defaultPeriod = 'month', today = dayKeyWib() }: { defaultPeriod?: Period; today?: string } = {}
): ResolvedPeriod {
	const period = (PERIODS as readonly string[]).includes(params.period ?? '')
		? (params.period as Period)
		: defaultPeriod;
	const anchor = isDay(params.from) ? params.from : today;

	let from: string;
	let to: string;
	let prevAnchor: string;
	let nextAnchor: string;
	let bucket: Bucket;
	let seriesFrom: string;

	switch (period) {
		case 'day':
			from = to = anchor;
			prevAnchor = addDays(anchor, -1);
			nextAnchor = addDays(anchor, 1);
			bucket = 'day';
			seriesFrom = addDays(to, -13);
			break;
		case 'week':
			from = weekStart(anchor);
			to = addDays(from, 6);
			prevAnchor = addDays(from, -7);
			nextAnchor = addDays(from, 7);
			bucket = 'week';
			seriesFrom = addDays(from, -7 * 7);
			break;
		case 'year':
			from = `${anchor.slice(0, 4)}-01-01`;
			to = `${anchor.slice(0, 4)}-12-31`;
			prevAnchor = `${Number(anchor.slice(0, 4)) - 1}-01-01`;
			nextAnchor = `${Number(anchor.slice(0, 4)) + 1}-01-01`;
			bucket = 'year';
			seriesFrom = `${Number(anchor.slice(0, 4)) - 2}-01-01`;
			break;
		case 'custom': {
			from = anchor;
			to = isDay(params.to) ? params.to : anchor;
			if (to < from) [from, to] = [to, from];
			if (daysBetween(from, to) > MAX_CUSTOM_DAYS) to = addDays(from, MAX_CUSTOM_DAYS - 1);
			const len = daysBetween(from, to);
			prevAnchor = addDays(from, -len);
			nextAnchor = addDays(from, len);
			bucket = len <= 31 ? 'day' : len <= 183 ? 'week' : 'month';
			seriesFrom = from;
			break;
		}
		default:
			from = monthStart(anchor);
			to = monthEnd(anchor);
			prevAnchor = addMonths(from, -1);
			nextAnchor = addMonths(from, 1);
			bucket = 'month';
			seriesFrom = addMonths(from, -5);
	}

	const days = daysBetween(from, to);
	// Bulanan / Tahunan compare with the previous calendar month / year; the rest with the
	// same number of days right before
	const prevTo = addDays(from, -1);
	const prevFrom =
		period === 'month'
			? monthStart(prevTo)
			: period === 'year'
				? `${prevTo.slice(0, 4)}-01-01`
				: addDays(from, -days);

	return {
		period,
		from,
		to,
		prevFrom,
		prevTo,
		prevAnchor,
		nextAnchor,
		// nextAnchor is the first day of the next period for every kind of period
		nextInFuture: nextAnchor > today,
		bucket,
		seriesFrom,
		fromInstant: wibLocalToDate(`${from}T00:00`)!,
		toInstant: wibLocalToDate(`${addDays(to, 1)}T00:00`)!,
		label: period === 'year' ? `Tahun ${from.slice(0, 4)}` : rangeLabel(from, to),
		days
	};
}

// ---------- chart buckets (Dashboard "View by Waktu") ----------

/** First day of the bucket holding `day`; matches Postgres date_trunc (weeks start Monday) */
export function bucketStart(day: string, bucket: Bucket) {
	if (bucket === 'week') return weekStart(day);
	if (bucket === 'month') return monthStart(day);
	if (bucket === 'year') return `${day.slice(0, 4)}-01-01`;
	return day;
}

/** Start day of every bucket from the one holding `from` to the one holding `to`, oldest first */
export function bucketStarts(from: string, to: string, bucket: Bucket) {
	const out: string[] = [];
	let d = bucketStart(from, bucket);
	while (d <= to) {
		out.push(d);
		d =
			bucket === 'day'
				? addDays(d, 1)
				: bucket === 'week'
					? addDays(d, 7)
					: bucket === 'month'
						? addMonths(d, 1)
						: `${Number(d.slice(0, 4)) + 1}-01-01`;
	}
	return out;
}

/** Axis label: "22 Okt" (day / week start), "Okt 2026", "2026" */
export function bucketLabel(start: string, bucket: Bucket) {
	if (bucket === 'year') return start.slice(0, 4);
	if (bucket === 'month') return `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
	return fmt(start, false);
}

/** Tooltip / table label: "22 Okt 2026", "19 – 25 Okt 2026", "Okt 2026", "Tahun 2026" */
export function bucketTitle(start: string, bucket: Bucket) {
	if (bucket === 'year') return `Tahun ${start.slice(0, 4)}`;
	if (bucket === 'month') return bucketLabel(start, bucket);
	if (bucket === 'week') return rangeLabel(start, addDays(start, 6));
	return fmt(start, true);
}

/** URL params for a period, keeping only what that period needs */
export function periodParams(period: Period, from: string, to?: string): Record<string, string> {
	return period === 'custom' ? { period, from, to: to ?? from } : { period, from };
}
