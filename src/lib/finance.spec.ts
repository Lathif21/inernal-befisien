import { describe, expect, it } from 'vitest';
import { delta } from './finance';

describe('delta', () => {
	it('compares with the previous period', () => {
		expect(delta(135, 100, true)).toEqual({ pct: 35, upIsGood: true });
		expect(delta(88, 100, false)).toEqual({ pct: -12, upIsGood: false });
	});
	it('measures a loss turning into a profit against the size of the loss', () => {
		expect(delta(50, -100, true)?.pct).toBe(150);
		expect(delta(-150, -100, true)?.pct).toBe(-50);
	});
	it('has nothing to compare with an empty previous period', () => {
		expect(delta(100, 0, true)).toBeUndefined();
	});
});
