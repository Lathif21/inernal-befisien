import { describe, expect, it } from 'vitest';
import {
	draftIsEmpty,
	parseSendAt,
	scheduleChoices,
	scheduleDefault,
	sendAtLabel,
	trashPurgeDate
} from './email-draft';

const empty = { to: '', cc: '', subject: '', body: '', uploads: [] as string[] };

describe('draftIsEmpty', () => {
	it('keeps a new email as soon as anything is filled in', () => {
		expect(draftIsEmpty(empty)).toBe(true);
		expect(draftIsEmpty({ ...empty, to: 'budi@contoh.id' })).toBe(false);
		expect(draftIsEmpty({ ...empty, subject: 'Penawaran' })).toBe(false);
		expect(draftIsEmpty({ ...empty, body: '<p>Halo</p>' })).toBe(false);
		expect(draftIsEmpty({ ...empty, uploads: ['f1'] })).toBe(false);
	});

	it('ignores the recipients and subject a reply was opened with', () => {
		const reply = { ...empty, threadId: 't1', to: 'budi@contoh.id', subject: 'Re: Penawaran' };
		expect(draftIsEmpty(reply)).toBe(true);
		expect(draftIsEmpty({ ...reply, body: '<p>Siap</p>' })).toBe(false);
	});

	it('keeps a forward once it has a recipient', () => {
		const fwd = { ...empty, forwardId: 'm1', subject: 'Fwd: Penawaran' };
		expect(draftIsEmpty(fwd)).toBe(true);
		expect(draftIsEmpty({ ...fwd, to: 'ani@contoh.id' })).toBe(false);
	});
});

describe('parseSendAt', () => {
	// 28 Okt 2026 10:00 WIB
	const now = new Date('2026-10-28T03:00:00Z');

	it('reads the WIB wall time', () => {
		const r = parseSendAt('2026-10-29', '08:00', now);
		expect('at' in r && r.at.toISOString()).toBe('2026-10-29T01:00:00.000Z');
	});

	it('refuses the past, the next minute, more than a year ahead and nonsense', () => {
		expect(parseSendAt('2026-10-28', '09:00', now)).toHaveProperty('error');
		expect(parseSendAt('2026-10-28', '10:01', now)).toHaveProperty('error');
		expect(parseSendAt('2027-12-01', '08:00', now)).toHaveProperty('error');
		expect(parseSendAt('2026-02-31', '08:00', now)).toHaveProperty('error');
		expect(parseSendAt('', '', now)).toHaveProperty('error');
	});
});

describe('schedule picks', () => {
	it('offers tomorrow and next Monday in WIB', () => {
		// Wednesday 28 Okt 2026, 23:30 WIB: tomorrow is already the 29th in WIB, not UTC
		const late = new Date('2026-10-28T16:30:00Z');
		expect(scheduleChoices(late)).toEqual([
			{ label: 'Besok pagi', date: '2026-10-29', time: '08:00' },
			{ label: 'Besok siang', date: '2026-10-29', time: '13:00' },
			{ label: 'Senin pagi', date: '2026-11-02', time: '08:00' }
		]);
	});

	it('starts from a saved time still ahead, else tomorrow 08:00', () => {
		const now = new Date('2026-10-28T03:00:00Z');
		expect(scheduleDefault('2026-10-30T02:30:00Z', now)).toEqual({
			date: '2026-10-30',
			time: '09:30'
		});
		expect(scheduleDefault('2026-10-27T02:30:00Z', now)).toEqual({
			date: '2026-10-29',
			time: '08:00'
		});
		expect(scheduleDefault(null, now)).toEqual({ date: '2026-10-29', time: '08:00' });
	});

	it('labels the time and the purge day', () => {
		expect(sendAtLabel('2026-10-30T02:00:00Z')).toBe('Jumat, 30 Okt 2026 09:00');
		expect(trashPurgeDate('2026-10-28T03:00:00Z').toISOString()).toBe('2026-11-27T03:00:00.000Z');
	});
});
