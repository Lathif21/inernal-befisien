// Project edit form and board move payload. Shared by the Proyek page and services/projects.ts.
// Projects are created from won deals (schemas/deal.ts wonProjectSchema), so this form only edits.
import { z } from 'zod';
import { PROJECT_STAGES, SERVICE_TYPES } from '../constants';

const uuidOrEmpty = (message: string) =>
	z
		.string()
		.default('')
		.refine((v) => v === '' || z.uuid().safeParse(v).success, { message });
const isoDateOrEmpty = z
	.string()
	.default('')
	.refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'Tanggal tidak valid.' });

export const projectSchema = z
	.object({
		id: z.string().refine((v) => z.uuid().safeParse(v).success, { message: 'Proyek tidak valid.' }),
		name: z
			.string()
			.trim()
			.min(3, 'Nama proyek minimal 3 karakter.')
			.max(150, 'Nama proyek maksimal 150 karakter.'),
		serviceType: z
			.string()
			.default('')
			.refine((v) => v === '' || (SERVICE_TYPES as readonly string[]).includes(v), {
				message: 'Pilih layanan dari daftar.'
			}),
		contractValue: z
			.number({ message: 'Masukkan angka.' })
			.int('Tanpa desimal.')
			.min(0, 'Tidak boleh negatif.')
			.max(999_999_999_999, 'Nilai terlalu besar.')
			.nullable()
			.default(null),
		startDate: isoDateOrEmpty,
		targetEndDate: isoDateOrEmpty,
		ownerId: z.string().default('')
	})
	.superRefine((p, ctx) => {
		if (p.startDate && p.targetEndDate && p.targetEndDate < p.startDate) {
			ctx.addIssue({
				code: 'custom',
				path: ['targetEndDate'],
				message: 'Target selesai tidak boleh sebelum tanggal mulai.'
			});
		}
	});

export type ProjectInput = z.infer<typeof projectSchema>;

/** A board move (drag or "Pindah ke…"), posted to the ?/move action */
export const projectMoveSchema = z.object({
	id: z.uuid({ message: 'Data tidak valid.' }),
	to: z.enum(PROJECT_STAGES),
	beforeId: uuidOrEmpty('Data tidak valid.'),
	afterId: uuidOrEmpty('Data tidak valid.')
});

export type ProjectMoveInput = z.infer<typeof projectMoveSchema>;
