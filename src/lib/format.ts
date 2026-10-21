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
