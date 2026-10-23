import { describe, expect, it } from 'vitest';
import { stepFields, stepValueOf, wibDatePlus } from './step-form';

describe('step form helpers', () => {
	it('counts quick dates on the WIB calendar', () => {
		// 23:30 WIB on 22 Okt is still 22 Okt in Jakarta (16:30 UTC)
		const lateEvening = new Date('2026-10-22T16:30:00Z');
		expect(wibDatePlus(1, lateEvening)).toBe('2026-10-23');
		expect(wibDatePlus(3, lateEvening)).toBe('2026-10-25');
		expect(wibDatePlus(7, lateEvening)).toBe('2026-10-29');
		// 00:30 WIB on 23 Okt is 22 Okt in UTC; "Besok" must be 24 Okt
		expect(wibDatePlus(1, new Date('2026-10-22T17:30:00Z'))).toBe('2026-10-24');
	});

	it('reads a stored step back as WIB date and time', () => {
		const v = stepValueOf({
			title: 'Demo',
			dueAt: '2026-10-23T07:30:00Z',
			allDay: false,
			assigneeId: null
		});
		expect(v).toEqual({
			title: 'Demo',
			dueDate: '2026-10-23',
			dueTime: '14:30',
			allDay: false,
			assigneeId: ''
		});
	});

	it('posts all-day steps without a time, with an optional prefix', () => {
		expect(
			stepFields(
				{ title: 'X', dueDate: '2026-10-23', dueTime: '10:00', allDay: true, assigneeId: 'u1' },
				'next.'
			)
		).toEqual({
			'next.title': 'X',
			'next.dueDate': '2026-10-23',
			'next.dueTime': '',
			'next.allDay': 'on',
			'next.assigneeId': 'u1'
		});
	});
});
