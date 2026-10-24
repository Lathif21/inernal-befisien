// Transaction form (drawer on Keuangan and the client page). Shared by the pages and
// services/transactions.ts. Amounts are whole Rupiah and always positive; `type` gives the direction.
import { z } from 'zod';
import { PAYMENT_METHODS, TXN_TYPES } from '../constants';

const uuidOrEmpty = (message: string) =>
	z
		.string()
		.default('')
		.refine((v) => v === '' || z.uuid().safeParse(v).success, { message });

/** Statuses the form offers; `cancelled` exists in the enum for later (invoices) */
export const FORM_TXN_STATUSES = ['paid', 'planned'] as const;

export const transactionSchema = z.object({
	/** '' = create */
	id: uuidOrEmpty('Transaksi tidak valid.'),
	type: z.enum(TXN_TYPES).default('income'),
	status: z.enum(FORM_TXN_STATUSES).default('paid'),
	date: z
		.string()
		.default('')
		.refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'Pilih tanggal.' }),
	amount: z
		.number({ message: 'Masukkan jumlah.' })
		.int('Tanpa desimal.')
		.min(1, 'Jumlah harus lebih dari 0.')
		.max(999_999_999_999, 'Jumlah terlalu besar.')
		.nullable()
		.default(null)
		.refine((v) => v !== null, { message: 'Masukkan jumlah.' }),
	/** '' only for overhead categories (P2-08); services/transactions.ts checks it against the category */
	clientId: uuidOrEmpty('Klien tidak valid.'),
	projectId: uuidOrEmpty('Proyek tidak valid.'),
	categoryId: z
		.string()
		.refine((v) => z.uuid().safeParse(v).success, { message: 'Pilih kategori.' }),
	method: z
		.string()
		.default('')
		.refine((v) => v === '' || (PAYMENT_METHODS as readonly string[]).includes(v), {
			message: 'Pilih metode dari daftar.'
		}),
	description: z.string().trim().max(500, 'Keterangan maksimal 500 karakter.').default(''),
	reference: z.string().trim().max(100, 'Referensi maksimal 100 karakter.').default('')
});

export type TransactionInput = z.infer<typeof transactionSchema>;
