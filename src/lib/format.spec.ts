import { describe, it, expect } from 'vitest';
import {
	dateID,
	dateToWibLocal,
	dayKeyWib,
	nowWib,
	npwpDisplay,
	phoneDisplay,
	phoneNormalize,
	rupiah,
	rupiahShort,
	wibLocalToDate
} from './format';

describe('phoneDisplay', () => {
	it('groups Indonesian numbers and prefixes others with +', () => {
		expect(phoneDisplay('6281234567890')).toBe('+62 812-3456-7890');
		expect(phoneDisplay('62215551234')).toBe('+62 215-5512-34');
		expect(phoneDisplay('6591234567')).toBe('+6591234567');
	});
});

describe('npwpDisplay', () => {
	it('formats 15 digits and leaves 16 digits plain', () => {
		expect(npwpDisplay('012345678901000')).toBe('01.234.567.8-901.000');
		expect(npwpDisplay('0123456789012345')).toBe('0123456789012345');
	});
});

describe('datetime-local in WIB', () => {
	it('reads the input as Jakarta wall time', () => {
		expect(wibLocalToDate('2026-10-23T14:30')?.toISOString()).toBe('2026-10-23T07:30:00.000Z');
		// 00:15 WIB is still the previous day in UTC
		expect(wibLocalToDate('2026-10-23T00:15')?.toISOString()).toBe('2026-10-22T17:15:00.000Z');
	});

	it('rejects malformed or impossible values', () => {
		expect(wibLocalToDate('')).toBeNull();
		expect(wibLocalToDate('23/10/2026 14:30')).toBeNull();
		expect(wibLocalToDate('2026-02-31T10:00')).toBeNull();
	});

	it('round-trips through the input format', () => {
		const instant = new Date('2026-10-22T17:15:00Z');
		expect(dateToWibLocal(instant)).toBe('2026-10-23T00:15');
		expect(wibLocalToDate(dateToWibLocal(instant))?.getTime()).toBe(instant.getTime());
	});
});

describe('dateID', () => {
	// 2026-10-22 03:00 UTC = Kamis 22 Okt 2026 10:00 WIB
	const instant = new Date('2026-10-22T03:00:00Z');

	it('formats instants in WIB with Indonesian names', () => {
		expect(dateID(instant)).toBe('22 Okt 2026');
		expect(dateID(instant, 'datetime')).toBe('22 Okt 10:00');
		expect(dateID(instant, 'long')).toBe('Kamis, 22 Okt 2026');
		expect(dateID(instant, 'time')).toBe('10:00');
	});

	it('uses the WIB calendar day, not UTC, near midnight', () => {
		// 17:30 UTC on the 21st is already 00:30 on the 22nd in Jakarta
		expect(dateID(new Date('2026-10-21T17:30:00Z'), 'datetime')).toBe('22 Okt 00:30');
	});

	it('treats yyyy-MM-dd as a calendar day without shifting it', () => {
		expect(dateID('2026-05-01')).toBe('1 Mei 2026');
		expect(dateID('2026-12-31', 'long')).toBe('Kamis, 31 Des 2026');
		expect(() => dateID('2026-05-01', 'time')).toThrow();
	});
});

describe('phoneNormalize', () => {
	it.each([
		['0812-3456-7890', '6281234567890'],
		['+62 812 3456 7890', '6281234567890'],
		['+62 (0)812 3456 7890', '6281234567890'],
		['62 0812 3456 7890', '6281234567890'],
		['6281234567890', '6281234567890'],
		['812 3456 7890', '6281234567890'],
		['(021) 555-1234', '62215551234'],
		['+65 9123 4567', '6591234567']
	])('%s → %s', (raw, expected) => {
		expect(phoneNormalize(raw)).toBe(expected);
	});

	it('returns null for empty or implausible input', () => {
		expect(phoneNormalize('')).toBeNull();
		expect(phoneNormalize(null)).toBeNull();
		expect(phoneNormalize('  ')).toBeNull();
		expect(phoneNormalize('abc')).toBeNull();
		expect(phoneNormalize('0812')).toBeNull();
		expect(phoneNormalize('0812 3456 7890 1234 5678')).toBeNull();
	});
});

describe('WIB time handling', () => {
	it('rolls over to the next day at midnight WIB, not UTC', () => {
		// 16:59 UTC = 23:59 WIB, 17:00 UTC = 00:00 WIB next day
		expect(dayKeyWib(new Date('2026-01-31T16:59:00Z'))).toBe('2026-01-31');
		expect(dayKeyWib(new Date('2026-01-31T17:00:00Z'))).toBe('2026-02-01');
	});

	it('reads wall-clock fields in WIB', () => {
		const d = nowWib(new Date('2026-03-10T01:30:00Z'));
		expect(d.getHours()).toBe(8);
		expect(d.getMinutes()).toBe(30);
	});
});

describe('rupiah', () => {
	it('uses dot thousands and no decimals', () => {
		expect(rupiah(12_500_000)).toBe('Rp 12.500.000');
		expect(rupiah(0)).toBe('Rp 0');
		expect(rupiah(-750_000)).toBe('−Rp 750.000');
	});
});

describe('rupiahShort', () => {
	it('shortens to jt / M / T with at most one decimal', () => {
		expect(rupiahShort(12_500_000)).toBe('Rp 12,5 jt');
		expect(rupiahShort(86_500_000)).toBe('Rp 86,5 jt');
		expect(rupiahShort(412_000_000)).toBe('Rp 412 jt');
		expect(rupiahShort(1_200_000_000)).toBe('Rp 1,2 M');
		expect(rupiahShort(3_000_000_000_000)).toBe('Rp 3 T');
	});

	it('keeps the full form below 1 jt and signs negatives', () => {
		expect(rupiahShort(750_000)).toBe('Rp 750.000');
		expect(rupiahShort(-31_200_000)).toBe('−Rp 31,2 jt');
	});
});
