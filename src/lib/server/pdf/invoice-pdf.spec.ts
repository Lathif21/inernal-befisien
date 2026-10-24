import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_COMPANY } from '../services/company';
import type { InvoiceDetail } from '../services/invoices';
import { invoiceDocument, invoiceFileName, renderInvoicePdf } from './invoice-pdf';

const company = { ...EXAMPLE_COMPANY, isExample: true };

const inv = {
	id: '00000000-0000-0000-0000-000000000001',
	number: 'INV/BEF/2026/10/001',
	clientId: '00000000-0000-0000-0000-000000000002',
	projectId: null,
	issueDate: '2026-10-24',
	dueDate: '2026-11-07',
	status: 'sent',
	subtotal: 59_000_000,
	ppnRate: 11,
	ppnAmount: 6_490_000,
	pph23Rate: 2,
	pph23Amount: 1_180_000,
	total: 65_490_000,
	notes: 'Termin 2 dari 3.',
	sentAt: new Date('2026-10-24T03:00:00Z'),
	createdBy: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	client: {
		name: 'PT Surya Daya Mandiri',
		npwp: '012345678901000',
		address: 'Jl. Rungkut Industri 12',
		city: 'Surabaya'
	},
	projectName: 'Integrasi SCADA ke dashboard',
	items: [
		{
			id: 'a',
			invoiceId: 'x',
			sort: 0,
			description: 'Termin 2 (40%) integrasi SCADA',
			qty: 1,
			unitPrice: 54_000_000,
			amount: 54_000_000
		},
		{
			id: 'b',
			invoiceId: 'x',
			sort: 1,
			description: 'Pendampingan operator (hari)',
			qty: 2.5,
			unitPrice: 2_000_000,
			amount: 5_000_000
		}
	]
} as InvoiceDetail;

describe('invoice PDF', () => {
	it('prints the totals, terbilang, bank and signer', () => {
		const text = JSON.stringify(invoiceDocument(inv, company).content);
		for (const s of [
			'INV/BEF/2026/10/001',
			'Rp 59.000.000',
			'PPN 11%',
			'Rp 65.490.000',
			'PPh 23 (2%) dipotong klien',
			'−Rp 1.180.000',
			'Rp 64.310.000',
			'Enam puluh lima juta empat ratus sembilan puluh ribu rupiah',
			'NPWP 01.234.567.8-901.000',
			'Bank Contoh',
			'Gusti Rafi A',
			'Surabaya, 24 Oktober 2026',
			'2,5'
		])
			expect(text).toContain(s);
	});

	it('signs above the signer name', () => {
		const doc = invoiceDocument(inv, company);
		expect(JSON.stringify(doc.content)).toContain('"image":"signature"');
		expect(doc.images?.signature).toMatch(/^data:image\/png;base64,/);
	});

	it('leaves taxes that are off out of the totals, and marks drafts', () => {
		const doc = invoiceDocument(
			{
				...inv,
				status: 'draft',
				ppnRate: 0,
				ppnAmount: 0,
				pph23Rate: 0,
				pph23Amount: 0,
				total: 59_000_000,
				notes: null,
				client: { ...inv.client, address: null, npwp: null }
			},
			{ ...company, address: '', signerTitle: '', bankAccountName: '' }
		);
		const text = JSON.stringify(doc.content);
		// missing optional lines are dropped, not printed as empty lines
		expect(text).not.toContain('""');
		expect(text).not.toContain('PPN');
		expect(text).not.toContain('Jumlah ditransfer');
		expect(doc.watermark).toMatchObject({ text: 'DRAF' });
	});

	it('renders a PDF file', { timeout: 30_000 }, async () => {
		const pdf = await renderInvoicePdf(inv, company);
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
		if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
		expect(invoiceFileName(inv.number)).toBe('INV-BEF-2026-10-001.pdf');
	});
});
