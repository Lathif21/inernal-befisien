// Email page forms (P3-08): write / reply, and link a thread to a client.
import { z } from 'zod';
import { EMAIL_UPLOAD_LIMIT, parseAddressList } from '../email';

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
	/** The editor's HTML, pictures included as base64 (EMAIL_UPLOAD_LIMIT checks the real size) */
	body: z
		.string()
		.trim()
		.min(1, 'Tulis isi email.')
		.max(EMAIL_UPLOAD_LIMIT + 100_000, 'Isi email terlalu besar.'),
	/** Made when the form opens: a double submit sends once */
	key: z.uuid(),
	/** Forward this stored email (Teruskan); its chosen attachments come as `forwardFiles` */
	forwardId: z.union([z.uuid(), z.literal('')]).default(''),
	/** The saved draft this email was written in; deleted once it is sent */
	draftId: z.union([z.uuid(), z.literal('')]).default('')
});

/**
 * A draft as the drawer holds it (P3-09): addresses stay as typed and are checked only when it is
 * sent or scheduled. `uploads` and `forwardFiles` come as repeated fields.
 */
export const emailDraftSchema = z.object({
	draftId: z.uuid(),
	threadId: z.union([z.uuid(), z.literal('')]).default(''),
	forwardId: z.union([z.uuid(), z.literal('')]).default(''),
	to: z.string().max(2000, 'Daftar alamat terlalu panjang.').default(''),
	cc: z.string().max(2000, 'Daftar alamat terlalu panjang.').default(''),
	subject: z.string().max(250, 'Subjek maksimal 250 karakter.').default(''),
	body: z
		.string()
		.max(EMAIL_UPLOAD_LIMIT + 100_000, 'Isi email terlalu besar.')
		.default('')
});

/** Jadwalkan: WIB date + time from the schedule panel */
export const emailScheduleSchema = z.object({
	sendDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pilih tanggal kirim.'),
	sendTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pilih jam kirim.')
});

export const emailLinkSchema = z.object({
	clientId: z.uuid('Pilih klien.'),
	addContact: z
		.string()
		.optional()
		.transform((v) => v === 'on')
});
