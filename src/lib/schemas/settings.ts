// Settings forms: users (P1-13), transaction categories, the company profile (P2-06) and Saran AI.
import { z } from 'zod';
import { TXN_TYPES, USER_ROLES } from '../constants';
import { AI_FREQUENCIES, AI_TIMES } from '../ai-schedule';
import { phoneNormalize } from '../format';

/** Empty = generate one and show it once */
const password = z
	.string()
	.default('')
	.refine((v) => v === '' || v.length >= 8, { message: 'Minimal 8 karakter, atau kosongkan.' })
	.refine((v) => v.length <= 128, { message: 'Maksimal 128 karakter.' });

export const newUserSchema = z.object({
	name: z.string().trim().min(2, 'Nama minimal 2 karakter.').max(80, 'Nama maksimal 80 karakter.'),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.refine((v) => z.email().safeParse(v).success, { message: 'Alamat email tidak valid.' }),
	role: z.enum(USER_ROLES).default('admin'),
	password
});
export type NewUserInput = z.infer<typeof newUserSchema>;

export const resetPasswordSchema = z.object({
	userId: z.string().min(1, 'Pengguna tidak valid.'),
	password
});

export const categorySchema = z.object({
	/** '' = create */
	id: z
		.string()
		.default('')
		.refine((v) => v === '' || z.uuid().safeParse(v).success, { message: 'Kategori tidak valid.' }),
	type: z.enum(TXN_TYPES).default('income'),
	name: z
		.string()
		.trim()
		.min(2, 'Nama kategori minimal 2 karakter.')
		.max(60, 'Nama kategori maksimal 60 karakter.'),
	/** Only for a new expense category (checkbox posts "on"); fixed afterwards */
	isOverhead: z
		.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
		.default(false)
});
export type CategoryInput = z.infer<typeof categorySchema>;

const text = (max: number, label: string) =>
	z.string().trim().max(max, `${label} maksimal ${max} karakter.`).default('');

/** Company details printed on invoices (P2-06). Empty optional fields are left off the PDF. */
export const companySchema = z.object({
	name: z
		.string()
		.trim()
		.min(2, 'Nama perusahaan minimal 2 karakter.')
		.max(120, 'Nama perusahaan maksimal 120 karakter.'),
	address: text(300, 'Alamat'),
	city: text(60, 'Kota'),
	phone: z
		.string()
		.trim()
		.default('')
		.refine((v) => v === '' || phoneNormalize(v) !== null, {
			message: 'Nomor tidak valid. Contoh: 0812-3456-7890.'
		}),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.max(200)
		.default('')
		.refine((v) => v === '' || z.email().safeParse(v).success, {
			message: 'Alamat email tidak valid.'
		}),
	npwp: z
		.string()
		.trim()
		.default('')
		.refine((v) => v === '' || [15, 16].includes(v.replace(/\D/g, '').length), {
			message: 'NPWP harus 15 atau 16 digit.'
		}),
	bankName: text(80, 'Nama bank'),
	bankAccountNumber: z
		.string()
		.trim()
		.max(40, 'Nomor rekening maksimal 40 karakter.')
		.default('')
		.refine((v) => /^[\d\s.-]*$/.test(v), { message: 'Nomor rekening hanya berisi angka.' }),
	bankAccountName: text(120, 'Nama pemilik rekening'),
	signerName: text(80, 'Nama penanda tangan'),
	signerTitle: text(80, 'Jabatan')
});
export type CompanyInput = z.infer<typeof companySchema>;

/** Pengaturan → Saran AI (checkbox posts "on") */
export const aiSettingsSchema = z.object({
	enabled: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
	frequency: z.enum(AI_FREQUENCIES, { message: 'Pilih jadwal.' }),
	time: z.enum(AI_TIMES as [string, ...string[]], { message: 'Pilih jam (kelipatan 30 menit).' }),
	weekday: z.coerce.number().int().min(1, 'Pilih hari.').max(7, 'Pilih hari.').default(1),
	monthDay: z.coerce.number().int().min(1, 'Tanggal 1–31.').max(31, 'Tanggal 1–31.').default(1)
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;
