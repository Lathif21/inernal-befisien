// State and wording of a card's next action (docs/design-system/components/NextActionBox).
// Everything is decided on the WIB calendar, never the server's local time.
import { differenceInCalendarDays, differenceInHours, format } from 'date-fns';
import { id as localeId } from 'date-fns/locale/id';
import { wib } from './format';

export type NextActionState = 'late' | 'today' | 'upcoming';

/** Whole calendar days from `from` to `to` in WIB (0 = same WIB day) */
export function wibDayDiff(from: Date | number, to: Date | number): number {
	return differenceInCalendarDays(to, from, { in: wib });
}

/**
 * late:     due time has passed (all-day steps are late only after their WIB day ends)
 * today:    due later today (WIB), or an all-day step for today
 * upcoming: due on a later WIB day
 */
export function nextActionState(
	dueAt: Date,
	now: Date = new Date(),
	allDay = false
): NextActionState {
	const days = wibDayDiff(now, dueAt);
	if (days < 0) return 'late';
	if (days > 0) return 'upcoming';
	if (allDay) return 'today';
	return dueAt.getTime() < now.getTime() ? 'late' : 'today';
}

/** "Terlambat 2 hari" · "Terlambat 3 jam" · "Hari ini 14:00" · "Besok, 23 Okt 13:00" · "Sel, 27 Okt 10:00" */
export function nextActionWhen(dueAt: Date, now: Date = new Date(), allDay = false): string {
	const state = nextActionState(dueAt, now, allDay);
	const time = format(dueAt, 'HH:mm', { in: wib });
	if (state === 'late') {
		const days = -wibDayDiff(now, dueAt);
		if (days >= 1) return `Terlambat ${days} hari`;
		const hours = Math.max(1, differenceInHours(now, dueAt));
		return `Terlambat ${hours} jam`;
	}
	if (state === 'today') return allDay ? 'Hari ini' : `Hari ini ${time}`;
	const day =
		wibDayDiff(now, dueAt) === 1 ? 'Besok' : format(dueAt, 'EEE', { in: wib, locale: localeId });
	const date = format(dueAt, 'd MMM', { in: wib, locale: localeId });
	return allDay ? `${day}, ${date}` : `${day}, ${date} ${time}`;
}

/** Whole WIB days a card has been in its column ("x hari di tahap ini") */
export function daysInStage(stageChangedAt: Date, now: Date = new Date()): number {
	return Math.max(0, wibDayDiff(stageChangedAt, now));
}
