// Client-side helpers for StepForm: default values, the quick date buttons and form fields.
// Dates are WIB calendar days.
import { addDays } from 'date-fns';
import { dateToWibLocal, dayKeyWib } from './format';

export type StepValue = {
	title: string;
	/** yyyy-MM-dd (WIB) */
	dueDate: string;
	/** HH:mm (WIB); ignored when allDay */
	dueTime: string;
	allDay: boolean;
	assigneeId: string;
};

/** WIB date `days` from today */
export function wibDatePlus(days: number, from: Date | number = Date.now()): string {
	return dayKeyWib(addDays(from, days));
}

export const QUICK_DATES = [
	{ label: 'Besok', days: 1 },
	{ label: '+3 hari', days: 3 },
	{ label: '+1 minggu', days: 7 }
] as const;

/** Empty step due tomorrow 10:00 WIB */
export function newStepValue(title = ''): StepValue {
	return { title, dueDate: wibDatePlus(1), dueTime: '10:00', allDay: false, assigneeId: '' };
}

/** Existing step → form value (WIB) */
export function stepValueOf(s: {
	title: string;
	dueAt: Date | string;
	allDay: boolean;
	assigneeId: string | null;
}): StepValue {
	const local = dateToWibLocal(new Date(s.dueAt));
	return {
		title: s.title,
		dueDate: local.slice(0, 10),
		dueTime: s.allDay ? '10:00' : local.slice(11, 16),
		allDay: s.allDay,
		assigneeId: s.assigneeId ?? ''
	};
}

/** Form fields for the step actions; `prefix` "next." for the next step of completeStep */
export function stepFields(v: StepValue, prefix = ''): Record<string, string> {
	return {
		[`${prefix}title`]: v.title,
		[`${prefix}dueDate`]: v.dueDate,
		[`${prefix}dueTime`]: v.allDay ? '' : v.dueTime,
		[`${prefix}allDay`]: v.allDay ? 'on' : '',
		[`${prefix}assigneeId`]: v.assigneeId
	};
}
