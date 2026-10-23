// Settings forms: users (P1-13) and transaction categories.
import { z } from 'zod';
import { TXN_TYPES, USER_ROLES } from '../constants';

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
		.max(60, 'Nama kategori maksimal 60 karakter.')
});
export type CategoryInput = z.infer<typeof categorySchema>;
