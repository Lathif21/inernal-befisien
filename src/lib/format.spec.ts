import { describe, it, expect } from 'vitest';
import { dayKeyWib, nowWib, rupiah, rupiahShort } from './format';

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
