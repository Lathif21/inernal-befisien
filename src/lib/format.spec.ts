import { describe, it, expect } from 'vitest';
import { dayKeyWib, nowWib } from './format';

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
