// Contact form schema, shared by the Kontak tab drawer and services/contacts.ts.
import { z } from 'zod';
import { phoneNormalize } from '../format';

const uuidOrEmpty = (message: string) =>
	z
		.string()
		.default('')
		.refine((v) => v === '' || z.uuid().safeParse(v).success, { message });

export const contactSchema = z.object({
	/** '' = create */
	id: uuidOrEmpty('Kontak tidak valid.'),
	name: z
		.string()
		.trim()
		.min(2, 'Nama kontak minimal 2 karakter.')
		.max(100, 'Nama kontak maksimal 100 karakter.'),
	position: z.string().trim().max(100, 'Jabatan maksimal 100 karakter.').default(''),
	/** Free input; stored normalised as 628… */
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
	isPrimary: z.boolean().default(false)
});

export type ContactInput = z.infer<typeof contactSchema>;
