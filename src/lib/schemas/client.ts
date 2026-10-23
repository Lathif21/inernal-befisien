// Client form schema, shared by the drawer form (Superforms) and services/clients.ts.
// Selects post '' for "not set"; the service turns '' into null.
import { z } from 'zod';
import { CLIENT_SOURCES, INDUSTRIES } from '../constants';

/** Statuses a person can pick; `archived` is only set through the Arsipkan action */
export const EDITABLE_CLIENT_STATUSES = ['prospect', 'active', 'inactive'] as const;

const choice = (values: readonly string[], message: string) =>
	z
		.string()
		.trim()
		.default('')
		.refine((v) => v === '' || values.includes(v), { message });

/** `example.com` or `https://example.com/...` */
export function looksLikeUrl(value: string): boolean {
	try {
		const url = new URL(value.includes('://') ? value : `https://${value}`);
		return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
	} catch {
		return false;
	}
}

export const clientSchema = z.object({
	/** '' = create, otherwise the client being edited */
	id: z
		.string()
		.default('')
		.refine((v) => v === '' || z.uuid().safeParse(v).success, { message: 'Klien tidak valid.' }),
	name: z
		.string()
		.trim()
		.min(2, 'Nama klien minimal 2 karakter.')
		.max(120, 'Nama klien maksimal 120 karakter.'),
	industry: choice(INDUSTRIES, 'Pilih industri dari daftar.'),
	source: choice(CLIENT_SOURCES, 'Pilih sumber dari daftar.'),
	status: z.enum(EDITABLE_CLIENT_STATUSES).default('prospect'),
	city: z.string().trim().max(80, 'Kota maksimal 80 karakter.').default(''),
	address: z.string().trim().max(500, 'Alamat maksimal 500 karakter.').default(''),
	website: z
		.string()
		.trim()
		.max(200, 'Website maksimal 200 karakter.')
		.default('')
		.refine((v) => v === '' || looksLikeUrl(v), { message: 'Alamat website tidak valid.' }),
	npwp: z
		.string()
		.trim()
		.default('')
		.refine((v) => v === '' || [15, 16].includes(v.replace(/\D/g, '').length), {
			message: 'NPWP harus 15 atau 16 digit.'
		}),
	ownerId: z.string().default(''),
	notes: z.string().trim().max(5000, 'Catatan maksimal 5000 karakter.').default('')
});

export type ClientInput = z.infer<typeof clientSchema>;
