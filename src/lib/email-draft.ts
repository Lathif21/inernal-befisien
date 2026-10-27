// Email drafts, scheduled sending and Sampah (P3-09). Pure and client-safe: the drawer uses the same
// rules as the server.
import { addDays, nextMonday } from 'date-fns';
import { dateToWibLocal, dateID, dayKeyWib, nowWib, wibLocalToDate } from './format';

/** Deleted conversations stay in Sampah this long, then the nightly task deletes them for good */
export const TRASH_DAYS = 30;

/** The day a conversation moved to Sampah is deleted for good */
export const trashPurgeDate = (deletedAt: Date | string) =>
	addDays(new Date(deletedAt), TRASH_DAYS);

/** A scheduled email goes at least this far ahead, and at most SCHEDULE_MAX_DAYS */
export const SCHEDULE_MIN_MINUTES = 2;
export const SCHEDULE_MAX_DAYS = 365;

export type DraftContent = {
	threadId?: string | null;
	forwardId?: string | null;
	to: string;
	cc: string;
	subject: string;
	/** The editor's HTML ('' when nothing was written) */
	body: string;
	uploads: string[];
};

/**
 * Nothing worth keeping: a reply or forward whose recipients and subject were filled in for the
 * writer counts as empty until something is written or attached.
 */
export function draftIsEmpty(d: DraftContent) {
	if (d.body.trim() || d.uploads.length) return false;
	if (d.threadId) return true;
	if (d.forwardId) return !d.to.trim();
	return !d.to.trim() && !d.cc.trim() && !d.subject.trim();
}

/** "2026-10-30" + "09:00" (WIB) → the instant, or an Indonesian error */
export function parseSendAt(
	date: string,
	time: string,
	now = new Date()
): { at: Date } | { error: string } {
	const at = wibLocalToDate(`${date}T${time}`);
	if (!at) return { error: 'Pilih tanggal dan jam kirim.' };
	if (at.getTime() < now.getTime() + SCHEDULE_MIN_MINUTES * 60_000)
		return { error: `Pilih waktu minimal ${SCHEDULE_MIN_MINUTES} menit dari sekarang.` };
	if (at.getTime() > addDays(now, SCHEDULE_MAX_DAYS).getTime())
		return { error: `Jadwal maksimal ${SCHEDULE_MAX_DAYS} hari dari sekarang.` };
	return { at };
}

/** Quick picks in the schedule panel (WIB): tomorrow morning / afternoon, next Monday morning */
export function scheduleChoices(now: Date | number = Date.now()) {
	const tomorrow = dayKeyWib(addDays(now, 1));
	const monday = dayKeyWib(nextMonday(nowWib(now)));
	return [
		{ label: 'Besok pagi', date: tomorrow, time: '08:00' },
		{ label: 'Besok siang', date: tomorrow, time: '13:00' },
		{ label: 'Senin pagi', date: monday, time: '08:00' }
	];
}

/** The panel's starting value: a saved schedule still ahead, else tomorrow 08:00 */
export function scheduleDefault(scheduledAt: Date | string | null | undefined, now = new Date()) {
	if (scheduledAt && new Date(scheduledAt).getTime() > now.getTime()) {
		const local = dateToWibLocal(new Date(scheduledAt));
		return { date: local.slice(0, 10), time: local.slice(11, 16) };
	}
	return { date: dayKeyWib(addDays(now, 1)), time: '08:00' };
}

/** "Kamis, 30 Okt 2026 09:00" */
export const sendAtLabel = (at: Date | string) => `${dateID(at, 'long')} ${dateID(at, 'time')}`;
