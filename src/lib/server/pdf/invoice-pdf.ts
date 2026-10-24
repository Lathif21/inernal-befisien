// Invoice PDF (P2-06): pdfmake with Plus Jakarta Sans and the logo mark, built from saved data only.
import pdfmake from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import regularFont from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff?inline';
import boldFont from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff?inline';
import logoSvg from '../../../../static/logo-mark.svg?raw';
// kept out of static/ so the signature is not a public download
import signaturePng from './signature.png?inline';
import { dateID, npwpDisplay, phoneDisplay, rupiah } from '../../format';
import { terbilangRupiah } from '../../terbilang';
import type { CompanyProfile } from '../services/company';
import type { InvoiceDetail } from '../services/invoices';

/** Colours from docs/design-system/tokens.json (a PDF cannot read the CSS variables) */
const C = {
	accent: '#1F5BEA',
	accentInk: '#1F4FD6',
	navy: '#0B1840',
	ink2: '#3E4C75',
	ink3: '#5E6A8E',
	line: '#DCE4F5',
	tint2: '#EEF3FF',
	danger: '#A12822',
	success: '#0E6B47'
};

// Fonts live in pdfmake's in-memory file system: nothing is read from disk at request time.
const vfs = (
	pdfmake as unknown as { virtualfs: { writeFileSync(name: string, data: Buffer): void } }
).virtualfs;
const fromDataUrl = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
vfs.writeFileSync('jakarta-400.woff', fromDataUrl(regularFont));
vfs.writeFileSync('jakarta-700.woff', fromDataUrl(boldFont));
pdfmake.setFonts({
	Jakarta: {
		normal: 'jakarta-400.woff',
		bold: 'jakarta-700.woff',
		italics: 'jakarta-400.woff',
		bolditalics: 'jakarta-700.woff'
	}
});
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => false);

/** fontkit takes a feature map; the typings only allow a list of features to switch on */
const NO_LIGATURES = { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

const qtyFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const rate = (n: number) => `${qtyFormat.format(n)}%`;

const WATERMARK: Partial<Record<InvoiceDetail['status'], { text: string; color: string }>> = {
	draft: { text: 'DRAF', color: C.accent },
	void: { text: 'DIBATALKAN', color: C.danger },
	paid: { text: 'LUNAS', color: C.success }
};

const label = (text: string): Content => ({
	text: text.toUpperCase(),
	fontSize: 7.5,
	bold: true,
	color: C.ink3,
	characterSpacing: 0.6,
	margin: [0, 0, 0, 3]
});

/** Drops missing optional lines; an empty string would still take up a line in pdfmake */
const compact = (items: (Content | false | null | undefined)[]): Content[] =>
	items.filter((c): c is Content => Boolean(c));

export function contactLine(company: CompanyProfile): string {
	return [company.phone && phoneDisplay(company.phone), company.email].filter(Boolean).join(' · ');
}

/** The document definition (pure, so it can be tested without rendering) */
export function invoiceDocument(inv: InvoiceDetail, company: CompanyProfile): TDocumentDefinitions {
	const contact = contactLine(company);

	const header: Content = {
		columns: [
			{ svg: logoSvg, width: 28 },
			{
				width: '*',
				margin: [10, 0, 0, 0],
				stack: compact([
					{ text: company.name, fontSize: 15, bold: true, color: C.navy },
					company.address && { text: company.address, margin: [0, 2, 0, 0] },
					contact && { text: contact },
					company.npwp && { text: `NPWP ${npwpDisplay(company.npwp)}` }
				]),
				fontSize: 8.5,
				color: C.ink2
			},
			{
				width: 'auto',
				alignment: 'right',
				stack: [
					{ text: 'INVOICE', fontSize: 22, bold: true, color: C.accent, characterSpacing: 1.5 },
					{ text: inv.number, fontSize: 10, bold: true, color: C.navy, margin: [0, 2, 0, 0] }
				]
			}
		]
	};

	const rule: Content = {
		canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: C.line }],
		margin: [0, 16, 0, 16]
	};

	const meta = (key: string, value: string): TableCell[] => [
		{ text: key, color: C.ink3 },
		{ text: value, bold: true, alignment: 'right' }
	];
	const parties: Content = {
		columns: [
			{
				width: '*',
				stack: compact([
					label('Ditagihkan kepada'),
					{ text: inv.client.name, fontSize: 11, bold: true },
					inv.client.address && { text: inv.client.address, color: C.ink2 },
					inv.client.city && { text: inv.client.city, color: C.ink2 },
					inv.client.npwp && {
						text: `NPWP ${npwpDisplay(inv.client.npwp)}`,
						color: C.ink2,
						margin: [0, 2, 0, 0]
					}
				])
			},
			{
				width: 220,
				table: {
					widths: ['auto', '*'],
					body: [
						meta('Tanggal invoice', dateID(inv.issueDate)),
						meta('Jatuh tempo', dateID(inv.dueDate)),
						...(inv.projectName ? [meta('Proyek', inv.projectName)] : [])
					]
				},
				layout: {
					hLineWidth: () => 0,
					vLineWidth: () => 0,
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: () => 1.5,
					paddingBottom: () => 1.5
				}
			}
		],
		columnGap: 24,
		margin: [0, 0, 0, 18]
	};

	const th = (text: string, alignment: 'left' | 'right' = 'left'): TableCell => ({
		text,
		bold: true,
		fontSize: 8,
		color: C.ink2,
		alignment
	});
	const items: Content = {
		table: {
			headerRows: 1,
			dontBreakRows: true,
			widths: [16, '*', 38, 82, 88],
			body: [
				[
					th('No'),
					th('Uraian'),
					th('Qty', 'right'),
					th('Harga satuan', 'right'),
					th('Jumlah', 'right')
				],
				...inv.items.map((it, i): TableCell[] => [
					{ text: String(i + 1), color: C.ink3 },
					it.description,
					{ text: qtyFormat.format(it.qty), alignment: 'right' },
					{ text: rupiah(it.unitPrice), alignment: 'right' },
					{ text: rupiah(it.amount), alignment: 'right', bold: true }
				])
			]
		},
		layout: {
			fillColor: (row) => (row === 0 ? C.tint2 : null),
			hLineWidth: (i, node) => (i === 0 || i === 1 ? 0 : i === node.table.body.length ? 1 : 0.5),
			hLineColor: () => C.line,
			vLineWidth: () => 0,
			paddingLeft: () => 6,
			paddingRight: () => 6,
			paddingTop: () => 6,
			paddingBottom: () => 6
		}
	};

	const sum = (key: string, value: string, strong = false): TableCell[] => [
		{ text: key, color: strong ? C.navy : C.ink2, bold: strong },
		{ text: value, alignment: 'right', bold: strong, color: C.navy }
	];
	const sums: TableCell[][] = [sum('Subtotal', rupiah(inv.subtotal))];
	if (inv.ppnRate > 0) sums.push(sum(`PPN ${rate(inv.ppnRate)}`, rupiah(inv.ppnAmount)));
	const totalRow = sums.length;
	sums.push(sum('Total invoice', rupiah(inv.total), true));
	if (inv.pph23Rate > 0) {
		sums.push(sum(`PPh 23 (${rate(inv.pph23Rate)}) dipotong klien`, rupiah(-inv.pph23Amount)), [
			{ text: 'Jumlah ditransfer', bold: true, color: C.accentInk },
			{
				text: rupiah(inv.total - inv.pph23Amount),
				alignment: 'right',
				bold: true,
				color: C.accentInk
			}
		]);
	}

	const totals: Content = {
		columns: [
			{
				width: '*',
				stack: compact([
					{
						table: {
							widths: ['*'],
							body: [
								[
									{
										stack: [
											label('Terbilang'),
											{ text: terbilangRupiah(inv.total), bold: true, color: C.navy }
										],
										fillColor: C.tint2,
										margin: [8, 6, 8, 6]
									}
								]
							]
						},
						layout: 'noBorders'
					},
					inv.notes && {
						stack: [label('Catatan'), { text: inv.notes, color: C.ink2 }],
						margin: [0, 12, 0, 0]
					}
				])
			},
			{
				width: 230,
				table: { widths: ['*', 'auto'], body: sums },
				layout: {
					hLineWidth: (i) => (i === totalRow ? 1 : 0),
					hLineColor: () => C.line,
					vLineWidth: () => 0,
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: (i) => (i === totalRow ? 7 : 2.5),
					paddingBottom: (i) => (i === totalRow ? 7 : 2.5)
				}
			}
		],
		columnGap: 24,
		margin: [0, 14, 0, 0]
	};

	const hasBank = Boolean(company.bankName || company.bankAccountNumber);
	const closing: Content = {
		unbreakable: true,
		margin: [0, 28, 0, 0],
		columns: [
			{
				width: '*',
				stack: hasBank
					? compact([
							label('Pembayaran ke'),
							company.bankName && { text: company.bankName, bold: true },
							company.bankAccountNumber && { text: `No. rekening ${company.bankAccountNumber}` },
							company.bankAccountName && { text: `a.n. ${company.bankAccountName}` },
							{
								text: 'Mohon cantumkan nomor invoice pada berita transfer.',
								fontSize: 8,
								color: C.ink3,
								margin: [0, 6, 0, 0]
							}
						])
					: []
			},
			{
				width: 200,
				alignment: 'center',
				stack: compact([
					{
						text: [company.city, dateID(inv.issueDate, 'full')].filter(Boolean).join(', '),
						color: C.ink2
					},
					{ text: 'Hormat kami,', color: C.ink2 },
					{ image: 'signature', fit: [120, 62], alignment: 'center', margin: [0, 2, 0, 2] },
					company.signerName
						? { text: company.signerName, bold: true, decoration: 'underline' }
						: { text: company.name, bold: true },
					company.signerTitle && { text: company.signerTitle, color: C.ink2 }
				])
			}
		]
	};

	const mark = WATERMARK[inv.status];
	return {
		pageSize: 'A4',
		pageMargins: [40, 40, 40, 48],
		info: { title: inv.number, author: company.name, subject: `Invoice ${inv.client.name}` },
		defaultStyle: {
			font: 'Jakarta',
			fontSize: 9,
			color: C.navy,
			lineHeight: 1.25,
			// no "fi" ligature: copied / searched text would read "Befsien"
			fontFeatures: NO_LIGATURES
		},
		watermark: mark && { ...mark, opacity: 0.08, bold: true },
		images: { signature: signaturePng },
		content: [header, rule, parties, items, totals, closing],
		footer: (page, pages) => ({
			margin: [40, 16, 40, 0],
			fontSize: 7.5,
			color: C.ink3,
			columns: [
				{ text: [company.name, contact].filter(Boolean).join(' · ') },
				{ text: `${inv.number} · halaman ${page} dari ${pages}`, alignment: 'right' }
			]
		})
	};
}

export function renderInvoicePdf(inv: InvoiceDetail, company: CompanyProfile): Promise<Buffer> {
	return pdfmake.createPdf(invoiceDocument(inv, company)).getBuffer();
}

/** `INV/BEF/2026/10/001` → `INV-BEF-2026-10-001.pdf` */
export function invoiceFileName(number: string): string {
	return `${number.replace(/[^\w-]+/g, '-')}.pdf`;
}
