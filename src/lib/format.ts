import { TZDate, tz } from '@date-fns/tz';
import { format } from 'date-fns';

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
