// A step (action) as entered in StepForm: a WIB date and time, or a whole day.
import { z } from 'zod';
import { wibLocalToDate } from '../format';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checkbox / string → boolean ("on", "true", true) */
const flag = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());

export const stepSchema = z
	.object({
		title: z
			.string()
			.trim()
			.min(3, 'Tulis langkahnya (min. 3 karakter).')
			.max(200, 'Maksimal 200 karakter.'),
		dueDate: z.string().regex(DATE, 'Pilih tanggal.'),
		/** HH:mm in WIB; empty when allDay */
		dueTime: z.string().default(''),
		allDay: flag.default(false),
		assigneeId: z.string().max(64).default('')
	})
	.superRefine((s, ctx) => {
		if (!s.allDay && !TIME.test(s.dueTime)) {
			ctx.addIssue({ code: 'custom', path: ['dueTime'], message: 'Pilih jam (WIB).' });
		}
		if (s.dueDate && DATE.test(s.dueDate) && !wibLocalToDate(`${s.dueDate}T00:00`)) {
			ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Tanggal tidak valid.' });
		}
	});

export type StepInput = z.infer<typeof stepSchema>;

/** The instant a step is due: its WIB time, or 00:00 WIB for an all-day step */
export function stepDueAt(s: StepInput): Date {
	return wibLocalToDate(`${s.dueDate}T${s.allDay ? '00:00' : s.dueTime}`)!;
}

/** Fields posted with a `prefix` (e.g. "next.title") → plain step fields */
export function stepFieldsFrom(data: Record<string, FormDataEntryValue>, prefix = '') {
	const pick = (k: string) => {
		const v = data[`${prefix}${k}`];
		return typeof v === 'string' ? v : undefined;
	};
	return {
		title: pick('title'),
		dueDate: pick('dueDate'),
		dueTime: pick('dueTime'),
		allDay: pick('allDay'),
		assigneeId: pick('assigneeId')
	};
}
