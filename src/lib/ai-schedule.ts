// When the scheduled Saran AI run happens (Pengaturan → Saran AI). Pure and client-safe: the
// Trigger.dev task checks `dueSlot` every 30 minutes, the settings page shows `nextRun`.
// All days and times are WIB.
import { dateToWibLocal, wibLocalToDate } from './format';
import { addDays } from './period';

export const AI_FREQUENCIES = ['daily', 'weekly', 'monthly', 'manual'] as const;
export type AiFrequency = (typeof AI_FREQUENCIES)[number];

export const AI_FREQUENCY_LABELS: Record<AiFrequency, string> = {
	daily: 'Harian',
	weekly: 'Mingguan',
	monthly: 'Bulanan',
	manual: 'Hanya manual'
};

/** Index 0 = Senin (weekday 1) … 6 = Minggu (weekday 7) */
export const WEEKDAY_LABELS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

/** 00:00, 00:30 … 23:30 */
export const AI_TIMES = Array.from(
	{ length: 48 },
	(_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
);

export type AiSchedule = {
	/** Saran AI on; when off the run still refreshes Ringkasan konteks, but makes no suggestions */
	enabled: boolean;
	frequency: AiFrequency;
	/** HH:MM */
	time: string;
	/** 1 = Senin … 7 = Minggu */
	weekday: number;
	/** 1–31; a shorter month runs on its last day */
	monthDay: number;
	lastRunAt: Date | null;
};

export const DEFAULT_AI_SCHEDULE: AiSchedule = {
	enabled: true,
	frequency: 'daily',
	time: '06:30',
	weekday: 1,
	monthDay: 1,
	lastRunAt: null
};

/** ISO weekday (1 = Monday) of a `yyyy-MM-dd` calendar day */
const isoWeekday = (day: string) => {
	const d = new Date(`${day}T00:00:00Z`).getUTCDay();
	return d === 0 ? 7 : d;
};

const daysInMonth = (day: string) => {
	const [y, m] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** The run time on one WIB calendar day, or null when that day has no run */
export function slotOn(
	day: string,
	s: Pick<AiSchedule, 'frequency' | 'time' | 'weekday' | 'monthDay'>
) {
	if (s.frequency === 'manual') return null;
	if (s.frequency === 'weekly' && isoWeekday(day) !== s.weekday) return null;
	if (
		s.frequency === 'monthly' &&
		Number(day.slice(8, 10)) !== Math.min(s.monthDay, daysInMonth(day))
	)
		return null;
	return wibLocalToDate(`${day}T${s.time}`);
}

/**
 * Today's slot when it is due: its time has passed and it has not run yet. A run the scheduler
 * missed (Trigger.dev late, a deploy) catches up later the same day; another day starts fresh.
 */
export function dueSlot(s: AiSchedule, now = new Date()): Date | null {
	const slot = slotOn(dateToWibLocal(now).slice(0, 10), s);
	if (!slot || now < slot) return null;
	if (s.lastRunAt && s.lastRunAt >= slot) return null;
	return slot;
}

/** The next run from now (today's still to come, else the next run day), or null for manual */
export function nextRun(s: AiSchedule, now = new Date()): Date | null {
	const today = dateToWibLocal(now).slice(0, 10);
	for (let i = 0; i < 62; i++) {
		const slot = slotOn(addDays(today, i), s);
		if (!slot) continue;
		if (slot > now || (i === 0 && dueSlot(s, now))) return slot;
	}
	return null;
}

/** Open suggestions last until the next run, plus a little */
export function suggestionTtlDays(frequency: AiFrequency) {
	return { daily: 7, weekly: 14, monthly: 35, manual: 14 }[frequency];
}

/** "Setiap hari pukul 06:30", "Setiap Senin pukul 06:30", "Setiap tanggal 1 pukul 06:30" */
export function scheduleText(s: Pick<AiSchedule, 'frequency' | 'time' | 'weekday' | 'monthDay'>) {
	switch (s.frequency) {
		case 'daily':
			return `Setiap hari pukul ${s.time}`;
		case 'weekly':
			return `Setiap ${WEEKDAY_LABELS[s.weekday - 1]} pukul ${s.time}`;
		case 'monthly':
			return `Setiap tanggal ${s.monthDay} pukul ${s.time}`;
		default:
			return 'Hanya saat diminta';
	}
}
