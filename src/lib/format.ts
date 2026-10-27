import { TZDate, tz } from '@date-fns/tz';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale/id';

/** All "today" / "late" / display logic runs in WIB, never the server's local time. */
export const TZ = 'Asia/Jakarta';

/** date-fns `in` option: `format(d, 'HH:mm', { in: wib })`. */
export const wib = tz(TZ);

/** The given instant (default: now) as a WIB-zoned date. */
export function nowWib(date: Date | number = Date.now()): TZDate {
	return new TZDate(+date, TZ);
}

/** Calendar day in WIB as `yyyy-MM-dd`, matching Postgres `date` columns. */
export function dayKeyWib(date: Date | number = Date.now()): string {
	return format(date, 'yyyy-MM-dd', { in: wib });
}

const DATE_PATTERNS = {
	/** 22 Okt 2026 */
	date: 'd MMM yyyy',
	/** 22 Okt 10:00 */
	datetime: 'd MMM HH:mm',
	/** 22 Okt (Kotak Masuk list, this year) */
	day: 'd MMM',
	/** Kamis, 22 Okt 2026 (greetings) */
	long: 'EEEE, d MMM yyyy',
	/** 22 Oktober 2026 (invoice PDF) */
	full: 'd MMMM yyyy',
	/** 10:00 */
	time: 'HH:mm'
} as const;
export type DateStyle = keyof typeof DATE_PATTERNS;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `<input type="datetime-local">` value (WIB wall time, `2026-10-23T14:30`) → instant. Null if malformed. */
export function wibLocalToDate(value: string): Date | null {
	const m = LOCAL_DATETIME.exec(value);
	if (!m) return null;
	const [y, mo, d, h, mi] = m.slice(1).map(Number);
	const date = new TZDate(y, mo - 1, d, h, mi, TZ);
	// reject rollovers such as 2026-02-31
	return date.getMonth() === mo - 1 && date.getDate() === d ? new Date(date.getTime()) : null;
}

/** Instant → `<input type="datetime-local">` value in WIB */
export function dateToWibLocal(date: Date | number = Date.now()): string {
	return format(date, "yyyy-MM-dd'T'HH:mm", { in: wib });
}

/**
 * Indonesian date display, always in WIB.
 * A `yyyy-MM-dd` string (Postgres `date`) is a calendar day and is never shifted by time zone.
 */
export function dateID(value: Date | number | string, style: DateStyle = 'date'): string {
	if (typeof value === 'string' && DATE_ONLY.test(value)) {
		if (style === 'datetime' || style === 'time') {
			throw new Error(`dateID: "${value}" is a calendar date and has no time`);
		}
		const [y, m, d] = value.split('-').map(Number);
		return format(new Date(y, m - 1, d), DATE_PATTERNS[style], { locale: localeId });
	}
	const instant = typeof value === 'string' ? new Date(value) : value;
	return format(instant, DATE_PATTERNS[style], { locale: localeId, in: wib });
}

/**
 * Normalise a phone number to digits with country code: `0812-3456-7890` → `6281234567890`.
 * Indonesian numbers (0…, 8…, 62…, +62 (0)…) become `62…`; other `+` numbers keep their code.
 * Returns null when empty or not a plausible number (8–15 digits).
 */
export function phoneNormalize(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	let digits = trimmed.replace(/\D/g, '');
	if (!digits) return null;

	if (digits.startsWith('62')) {
		digits = '62' + digits.slice(2).replace(/^0+/, '');
	} else if (digits.startsWith('0')) {
		digits = '62' + digits.replace(/^0+/, '');
	} else if (digits.startsWith('8') && !trimmed.startsWith('+')) {
		digits = '62' + digits;
	}

	return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Stored `6281234567890` → `+62 812-3456-7890` for display; other numbers get a `+` only */
export function phoneDisplay(stored: string): string {
	if (!stored.startsWith('62')) return `+${stored}`;
	const local = stored.slice(2);
	const groups = [local.slice(0, 3), local.slice(3, 7), local.slice(7)].filter(Boolean);
	return `+62 ${groups.join('-')}`;
}

/** Stored digits → `01.234.567.8-901.000` (15-digit NPWP); 16-digit NPWP (NIK form) stays plain */
export function npwpDisplay(stored: string): string {
	const d = stored.replace(/\D/g, '');
	if (d.length !== 15) return d;
	return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12)}`;
}

const MINUS = '−';
const fullNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const shortNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** Full form for tables and forms: `Rp 12.500.000`. Money is whole Rupiah. */
export function rupiah(amount: number): string {
	const sign = amount < 0 ? MINUS : '';
	return `${sign}Rp ${fullNumber.format(Math.abs(amount))}`;
}

/** Short form for cards, tiles and charts: `Rp 12,5 jt`, `Rp 1,2 M`. Below 1 jt uses the full form. */
export function rupiahShort(amount: number): string {
	const abs = Math.abs(amount);
	const sign = amount < 0 ? MINUS : '';
	if (abs >= 1e12) return `${sign}Rp ${shortNumber.format(abs / 1e12)} T`;
	if (abs >= 1e9) return `${sign}Rp ${shortNumber.format(abs / 1e9)} M`;
	if (abs >= 1e6) return `${sign}Rp ${shortNumber.format(abs / 1e6)} jt`;
	return rupiah(amount);
}
