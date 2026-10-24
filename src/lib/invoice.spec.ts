import { describe, expect, it } from 'vitest';
import {
	formatInvoiceNumber,
	invoiceTotals,
	lineAmount,
	paymentStatus,
	percentOf
} from './invoice';

describe('invoice arithmetic', () => {
	it('computes lines with decimal quantities in whole Rupiah', () => {
		expect(lineAmount(1, 15_000_000)).toBe(15_000_000);
		expect(lineAmount(1.5, 2_500_000)).toBe(3_750_000);
		expect(lineAmount(0.33, 1_000)).toBe(330);
		// 2.5 × 333 = 832.5 → rounds half up
		expect(lineAmount(2.5, 333)).toBe(833);
		// float trap: 0.1 + 0.2 style inputs still land on the exact cent
		expect(lineAmount(0.29, 100)).toBe(29);
	});

	it('applies PPN 11% and PPh 23 2% on the subtotal (data model example)', () => {
		const t = invoiceTotals(
			[
				{ qty: 1, unitPrice: 40_000_000 },
				{ qty: 2, unitPrice: 5_000_000 }
			],
			{ ppnRate: 11, pph23Rate: 2 }
		);
		expect(t).toEqual({
			lines: [40_000_000, 10_000_000],
			subtotal: 50_000_000,
			ppnAmount: 5_500_000,
			pph23Amount: 1_000_000,
			total: 55_500_000,
			expectedCash: 54_500_000
		});
	});

	it('treats a rate of 0 as off and rounds odd percentages', () => {
		const t = invoiceTotals([{ qty: 1, unitPrice: 1_234_567 }], { ppnRate: 0, pph23Rate: 0 });
		expect([t.total, t.expectedCash]).toEqual([1_234_567, 1_234_567]);
		expect(percentOf(1_234_567, 11)).toBe(135_802); // 135 802.37
		expect(percentOf(999, 2)).toBe(20); // 19.98
		expect(percentOf(100_000_000_000, 11)).toBe(11_000_000_000); // no float drift at 100 M
	});

	it('numbers invoices per issue month', () => {
		expect(formatInvoiceNumber('2026-10-24', 7)).toBe('INV/BEF/2026/10/007');
		expect(formatInvoiceNumber('2027-01-02', 1234)).toBe('INV/BEF/2027/01/1234');
	});
});

describe('paymentStatus', () => {
	const inv = { total: 49_950_000, pph23Amount: 900_000, dueDate: '2026-11-07' };
	it('is paid once the cash after PPh 23 is in, partial before, overdue only with nothing paid', () => {
		expect(paymentStatus({ ...inv, paid: 49_050_000, today: '2026-10-24' })).toBe('paid');
		expect(paymentStatus({ ...inv, paid: 49_950_000, today: '2026-10-24' })).toBe('paid');
		expect(paymentStatus({ ...inv, paid: 1, today: '2026-12-01' })).toBe('partial');
		expect(paymentStatus({ ...inv, paid: 0, today: '2026-11-07' })).toBe('sent');
		expect(paymentStatus({ ...inv, paid: 0, today: '2026-11-08' })).toBe('overdue');
	});
});
