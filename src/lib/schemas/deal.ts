// Deal form (create / edit drawer) and board move payloads. Shared by the page and services/deals.ts.
import { z } from 'zod';
import { DEAL_STAGES, OPEN_DEAL_STAGES, SERVICE_TYPES } from '../constants';
import { wibLocalToDate } from '../format';

const uuid = () => z.uuid({ message: 'Data tidak valid.' });
const uuidOrEmpty = (message: string) =>
	z
		.string()
		.default('')
		.refine((v) => v === '' || z.uuid().safeParse(v).success, { message });
const isoDateOrEmpty = z
	.string()
	.default('')
	.refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'Tanggal tidak valid.' });
const localDateTime = (message: string) =>
	z
		.string()
		.default('')
		.refine((v) => v === '' || wibLocalToDate(v) !== null, {
			message: 'Tanggal dan jam tidak valid.'
		})
		.refine((v) => v !== '', { message });
const rupiah = z
	.number({ message: 'Masukkan angka.' })
	.int('Tanpa desimal.')
	.min(0, 'Tidak boleh negatif.')
	.max(999_999_999_999, 'Nilai terlalu besar.')
	.nullable()
	.default(null);

export const dealSchema = z
	.object({
		/** '' = create */
		id: uuidOrEmpty('Deal tidak valid.'),
		clientId: z.string().refine((v) => z.uuid().safeParse(v).success, { message: 'Pilih klien.' }),
		title: z
			.string()
			.trim()
			.min(3, 'Judul deal minimal 3 karakter.')
			.max(150, 'Judul deal maksimal 150 karakter.'),
		serviceType: z
			.string()
			.default('')
			.refine((v) => v === '' || (SERVICE_TYPES as readonly string[]).includes(v), {
				message: 'Pilih layanan dari daftar.'
			}),
		/** New deals start in an open stage; the board moves them afterwards */
		stage: z.enum(OPEN_DEAL_STAGES).default('lead'),
		valueEstimate: rupiah,
		expectedClose: isoDateOrEmpty,
		ownerId: z.string().default(''),
		/** First step, required when creating: every active card keeps an open step */
		firstStepTitle: z.string().trim().max(200).default(''),
		firstStepDue: z.string().default('')
	})
	.superRefine((d, ctx) => {
		if (d.id !== '') return;
		if (d.firstStepTitle.length < 3) {
			ctx.addIssue({
				code: 'custom',
				path: ['firstStepTitle'],
				message: 'Tulis langkah pertama (min. 3 karakter).'
			});
		}
		if (!d.firstStepDue || !wibLocalToDate(d.firstStepDue)) {
			ctx.addIssue({
				code: 'custom',
				path: ['firstStepDue'],
				message: 'Pilih tanggal dan jam langkah pertama.'
			});
		}
	});

export type DealInput = z.infer<typeof dealSchema>;

/** Project fields of the "Deal menang! Buat proyek sekarang?" modal */
export const wonProjectSchema = z.object({
	projectName: z.string().trim().min(3, 'Nama proyek minimal 3 karakter.').max(150),
	contractValue: z.coerce
		.number({ message: 'Masukkan nilai kontrak.' })
		.int()
		.min(0, 'Tidak boleh negatif.')
		.max(999_999_999_999),
	startDate: isoDateOrEmpty.refine((v) => v !== '', { message: 'Pilih tanggal mulai.' }),
	firstStepTitle: z.string().trim().min(3, 'Tulis langkah pertama proyek.').max(200),
	firstStepDue: localDateTime('Pilih tanggal dan jam langkah pertama.')
});

export type WonProjectInput = z.infer<typeof wonProjectSchema>;

/** A board move (drag or "Pindah ke…"), posted to the ?/move action */
export const moveSchema = z
	.object({
		id: uuid(),
		to: z.enum(DEAL_STAGES),
		beforeId: uuidOrEmpty('Data tidak valid.'),
		afterId: uuidOrEmpty('Data tidak valid.'),
		/** Batal: one of LOST_REASONS, optionally with free text */
		lostReason: z.string().trim().max(500).default(''),
		/** Deal ✓: "yes" when "Buat Proyek" was chosen */
		createProject: z.enum(['yes', '']).default(''),
		/** Out of Deal ✓: "yes" confirms deleting the project made from the deal (human error) */
		dropProject: z.enum(['yes', '']).default('')
	})
	.superRefine((m, ctx) => {
		if (m.to === 'lost' && m.lostReason.length < 3) {
			ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'Alasan batal wajib diisi.' });
		}
	});

export type MoveInput = z.infer<typeof moveSchema>;
