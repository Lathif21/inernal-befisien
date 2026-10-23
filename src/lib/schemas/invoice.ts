// Invoice input (P2-04 / P2-05). Amounts are whole Rupiah; totals are never taken from the
// browser: the server recomputes them with lib/invoice.ts.
import { z } from 'zod';
import { DEFAULT_PPH23_RATE, DEFAULT_PPN_RATE } from '../invoice';

const day = (message: string) =>
	z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), { message });

export const invoiceItemSchema = z.object({
	description: z
		.string()
		.trim()
		.min(2, 'Tulis uraian item.')
		.max(300, 'Uraian maksimal 300 karakter.'),
	qty: z.coerce
		.number({ message: 'Jumlah harus angka.' })
		.positive('Jumlah harus lebih dari 0.')
		.max(99_999_999, 'Jumlah terlalu besar.')
		// 1.5 and 0.25 are fine; 0.333 is not (qty is numeric(10,2))
		.refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
			message: 'Maksimal 2 angka di belakang koma.'
		}),
	unitPrice: z.coerce
		.number({ message: 'Harga harus angka.' })
		.int('Harga tanpa desimal.')
		.min(0, 'Harga tidak boleh negatif.')
		.max(999_999_999_999, 'Harga terlalu besar.')
});

export const invoiceSchema = z
	.object({
		/** '' = create */
		id: z
			.string()
			.default('')
			.refine((v) => v === '' || z.uuid().safeParse(v).success, {
				message: 'Invoice tidak valid.'
			}),
		clientId: z.string().refine((v) => z.uuid().safeParse(v).success, { message: 'Pilih klien.' }),
		projectId: z
			.string()
			.default('')
			.refine((v) => v === '' || z.uuid().safeParse(v).success, { message: 'Proyek tidak valid.' }),
		issueDate: day('Pilih tanggal invoice.'),
		dueDate: day('Pilih tanggal jatuh tempo.'),
		ppnRate: z.coerce.number().min(0).max(100).default(DEFAULT_PPN_RATE),
		pph23Rate: z.coerce.number().min(0).max(100).default(DEFAULT_PPH23_RATE),
		notes: z.string().trim().max(2000, 'Catatan maksimal 2000 karakter.').default(''),
		items: z.array(invoiceItemSchema).min(1, 'Tambahkan minimal satu item.').max(50)
	})
	.refine((v) => v.dueDate >= v.issueDate, {
		path: ['dueDate'],
		message: 'Jatuh tempo tidak boleh sebelum tanggal invoice.'
	});

export type InvoiceInput = z.infer<typeof invoiceSchema>;
