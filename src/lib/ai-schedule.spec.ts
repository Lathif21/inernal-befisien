import { describe, expect, it } from 'vitest';
import {
	DEFAULT_AI_SCHEDULE,
	dueSlot,
	nextRun,
	scheduleText,
	slotOn,
	suggestionTtlDays,
	type AiSchedule
} from './ai-schedule';

/** A WIB wall time as an instant */
const wib = (local: string) => new Date(`${local}:00+07:00`);
const s = (fields: Partial<AiSchedule>): AiSchedule => ({ ...DEFAULT_AI_SCHEDULE, ...fields });

describe('ai schedule', () => {
	it('daily: due once the time has passed, once per day, catching up later that day', () => {
		const daily = s({ time: '06:30' });
		expect(dueSlot(daily, wib('2026-10-26T06:00'))).toBeNull();
		expect(dueSlot(daily, wib('2026-10-26T06:30'))).toEqual(wib('2026-10-26T06:30'));
		// the scheduler was late: still due at 09:00
		expect(dueSlot(daily, wib('2026-10-26T09:00'))).toEqual(wib('2026-10-26T06:30'));
		// already ran today
		expect(
			dueSlot({ ...daily, lastRunAt: wib('2026-10-26T06:31') }, wib('2026-10-26T09:00'))
		).toBeNull();
		// yesterday's run does not count for today
		expect(
			dueSlot({ ...daily, lastRunAt: wib('2026-10-25T06:31') }, wib('2026-10-26T07:00'))
		).toEqual(wib('2026-10-26T06:30'));
	});

	it('weekly and monthly run only on their day; a short month uses its last day', () => {
		const monday = s({ frequency: 'weekly', weekday: 1, time: '08:00' });
		expect(slotOn('2026-10-26', monday)).toEqual(wib('2026-10-26T08:00')); // Monday
		expect(slotOn('2026-10-27', monday)).toBeNull();
		const sunday = s({ frequency: 'weekly', weekday: 7, time: '08:00' });
		expect(slotOn('2026-10-25', sunday)).not.toBeNull();

		const the31st = s({ frequency: 'monthly', monthDay: 31, time: '07:00' });
		expect(slotOn('2026-10-31', the31st)).toEqual(wib('2026-10-31T07:00'));
		expect(slotOn('2026-11-30', the31st)).toEqual(wib('2026-11-30T07:00'));
		expect(slotOn('2026-11-29', the31st)).toBeNull();
		expect(slotOn('2028-02-29', the31st)).not.toBeNull(); // leap year

		expect(slotOn('2026-10-26', s({ frequency: 'manual' }))).toBeNull();
	});

	it('shows the next run, the text and how long suggestions last', () => {
		const monday = s({ frequency: 'weekly', weekday: 1, time: '08:00' });
		expect(nextRun(monday, wib('2026-10-24T10:00'))).toEqual(wib('2026-10-26T08:00'));
		expect(nextRun(s({ time: '06:30' }), wib('2026-10-26T05:00'))).toEqual(wib('2026-10-26T06:30'));
		expect(
			nextRun(s({ time: '06:30', lastRunAt: wib('2026-10-26T06:30') }), wib('2026-10-26T07:00'))
		).toEqual(wib('2026-10-27T06:30'));
		expect(nextRun(s({ frequency: 'manual' }))).toBeNull();

		expect(scheduleText(monday)).toBe('Setiap Senin pukul 08:00');
		expect(scheduleText(s({ frequency: 'monthly', monthDay: 15, time: '07:30' }))).toBe(
			'Setiap tanggal 15 pukul 07:30'
		);
		expect(scheduleText(s({ frequency: 'manual' }))).toBe('Hanya saat diminta');
		expect([
			suggestionTtlDays('daily'),
			suggestionTtlDays('weekly'),
			suggestionTtlDays('monthly')
		]).toEqual([7, 14, 35]);
	});
});
