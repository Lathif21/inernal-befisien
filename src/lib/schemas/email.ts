// Email page forms (P3-08): write / reply, and link a thread to a client.
import { z } from 'zod';
import { parseAddressList } from '../email';

const addressList = (required: boolean) =>
	z
		.string()
		.trim()
		.max(2000, 'Daftar alamat terlalu panjang.')
		.default('')
		.transform((value, ctx) => {
			const { addresses, invalid } = parseAddressList(value);
			if (invalid.length)
				ctx.addIssue({ code: 'custom', message: `Alamat tidak valid: ${invalid.join(', ')}` });
			else if (required && !addresses.length)
				ctx.addIssue({ code: 'custom', message: 'Isi minimal satu penerima.' });
			else if (addresses.length > 20)
				ctx.addIssue({ code: 'custom', message: 'Maksimal 20 penerima.' });
			return addresses;
		});

export const emailSendSchema = z.object({
	/** Empty = a new email */
	threadId: z.union([z.uuid(), z.literal('')]).default(''),
	to: addressList(true),
	cc: addressList(false),
	subject: z.string().trim().max(250, 'Subjek maksimal 250 karakter.').default(''),
	body: z.string().trim().min(1, 'Tulis isi email.').max(50_000, 'Isi email terlalu panjang.'),
	/** Made when the form opens: a double submit sends once */
	key: z.uuid()
});

export const emailLinkSchema = z.object({
	clientId: z.uuid('Pilih klien.'),
	addContact: z
		.string()
		.optional()
		.transform((v) => v === 'on')
});
