// Manual timeline entry (note, call, meeting, WhatsApp, email) from the Aktivitas tab.
import { z } from 'zod';
import { MANUAL_ACTIVITY_TYPES } from '../constants';
import { wibLocalToDate } from '../format';

export const noteSchema = z.object({
	type: z.enum(MANUAL_ACTIVITY_TYPES).default('note'),
	body: z
		.string()
		.trim()
		.min(2, 'Tulis catatan minimal 2 karakter.')
		.max(5000, 'Catatan maksimal 5000 karakter.'),
	/** datetime-local in WIB; '' = now. Back-dating is allowed, the future is not. */
	occurredAt: z
		.string()
		.default('')
		.refine((v) => v === '' || wibLocalToDate(v) !== null, { message: 'Tanggal tidak valid.' })
		.refine(
			(v) => {
				const d = v === '' ? null : wibLocalToDate(v);
				return !d || d.getTime() <= Date.now() + 60_000;
			},
			{ message: 'Waktu tidak boleh di masa depan.' }
		)
});

export type NoteInput = z.infer<typeof noteSchema>;
