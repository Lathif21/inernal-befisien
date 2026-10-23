import { describe, expect, it } from 'vitest';
import { daysInStage, nextActionState, nextActionWhen } from './next-action';

// Helpers: build instants from WIB wall time (UTC+7, no DST)
const wib = (s: string) => new Date(`${s}+07:00`);

describe('nextActionState (WIB)', () => {
	const now = wib('2026-10-22T10:00:00'); // Kamis 22 Okt 2026, 10:00 WIB

	it('is late when the due time has passed, today when it is later today', () => {
		expect(nextActionState(wib('2026-10-22T09:59:00'), now)).toBe('late');
		expect(nextActionState(wib('2026-10-22T10:01:00'), now)).toBe('today');
		expect(nextActionState(wib('2026-10-21T23:59:00'), now)).toBe('late');
		expect(nextActionState(wib('2026-10-23T00:00:00'), now)).toBe('upcoming');
	});

	it('uses the WIB day, not UTC, around midnight', () => {
		// 23:30 WIB on the 22nd is 16:30 UTC; 00:30 WIB on the 23rd is still the 22nd in UTC
		const lateEvening = wib('2026-10-22T23:30:00');
		expect(nextActionState(wib('2026-10-23T00:30:00'), lateEvening)).toBe('upcoming');
		const justAfterMidnight = wib('2026-10-23T00:10:00');
		expect(nextActionState(wib('2026-10-22T23:50:00'), justAfterMidnight)).toBe('late');
		expect(nextActionState(wib('2026-10-23T08:00:00'), justAfterMidnight)).toBe('today');
	});

	it('treats all-day steps as late only after their WIB day ends', () => {
		const dueDay = wib('2026-10-22T00:00:00');
		expect(nextActionState(dueDay, wib('2026-10-22T23:59:00'), true)).toBe('today');
		expect(nextActionState(dueDay, wib('2026-10-23T00:00:00'), true)).toBe('late');
	});
});

describe('nextActionWhen', () => {
	const now = wib('2026-10-22T10:00:00');

	it('words each state in Bahasa Indonesia', () => {
		expect(nextActionWhen(wib('2026-10-20T10:00:00'), now)).toBe('Terlambat 2 hari');
		expect(nextActionWhen(wib('2026-10-22T07:00:00'), now)).toBe('Terlambat 3 jam');
		expect(nextActionWhen(wib('2026-10-22T09:40:00'), now)).toBe('Terlambat 1 jam');
		expect(nextActionWhen(wib('2026-10-22T14:00:00'), now)).toBe('Hari ini 14:00');
		expect(nextActionWhen(wib('2026-10-23T13:00:00'), now)).toBe('Besok, 23 Okt 13:00');
		expect(nextActionWhen(wib('2026-10-27T10:00:00'), now)).toBe('Sel, 27 Okt 10:00');
	});

	it('drops the time for all-day steps', () => {
		expect(nextActionWhen(wib('2026-10-22T00:00:00'), now, true)).toBe('Hari ini');
		expect(nextActionWhen(wib('2026-10-23T00:00:00'), now, true)).toBe('Besok, 23 Okt');
	});
});

describe('daysInStage', () => {
	it('counts WIB calendar days, never negative', () => {
		const now = wib('2026-10-22T00:30:00');
		expect(daysInStage(wib('2026-10-21T23:50:00'), now)).toBe(1);
		expect(daysInStage(wib('2026-10-22T00:10:00'), now)).toBe(0);
		expect(daysInStage(wib('2026-10-10T12:00:00'), now)).toBe(12);
		expect(daysInStage(wib('2026-10-23T12:00:00'), now)).toBe(0);
	});
});
