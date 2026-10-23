// Invoice arithmetic (docs/02-DATA-MODEL.md "Totals are computed on the server"). Pure and
// client-safe: the editor shows live totals with it, and the server recomputes with it before saving.
// Whole Rupiah only. Quantities have up to 2 decimals and rates up to 2 decimals, so the maths runs
// in BigInt on scaled integers: no float rounding, safe far beyond realistic invoice values.

export const DEFAULT_PPN_RATE = 11;
export const DEFAULT_PPH23_RATE = 2;

/** a × b / divisor, rounded half up (inputs are non-negative) */
function mulDivRound(a: bigint, b: bigint, divisor: bigint) {
	return Number((a * b + divisor / 2n) / divisor);
}

/** round(qty × unitPrice); qty may have 2 decimals (1.5 days) */
export function lineAmount(qty: number, unitPrice: number) {
	return mulDivRound(BigInt(Math.round(qty * 100)), BigInt(unitPrice), 100n);
}

/** round(amount × rate / 100); rate in percent with up to 2 decimals */
export function percentOf(amount: number, rate: number) {
	return mulDivRound(BigInt(amount), BigInt(Math.round(rate * 100)), 10_000n);
}

export type InvoiceTotals = {
	/** One amount per line, in order */
	lines: number[];
	subtotal: number;
	ppnAmount: number;
	pph23Amount: number;
	/** Invoice face value = subtotal + PPN */
	total: number;
	/** What reaches the bank = total − PPh 23 (withheld by the client) */
	expectedCash: number;
};

/**
 * Totals of an invoice. A rate of 0 means that tax is off.
 *   subtotal = Σ line amounts, PPN = subtotal × ppn%, PPh 23 = subtotal × pph23%
 */
export function invoiceTotals(
	lines: { qty: number; unitPrice: number }[],
	rates: { ppnRate: number; pph23Rate: number }
): InvoiceTotals {
	const amounts = lines.map((l) => lineAmount(l.qty, l.unitPrice));
	const subtotal = amounts.reduce((s, a) => s + a, 0);
	const ppnAmount = percentOf(subtotal, rates.ppnRate);
	const pph23Amount = percentOf(subtotal, rates.pph23Rate);
	const total = subtotal + ppnAmount;
	return {
		lines: amounts,
		subtotal,
		ppnAmount,
		pph23Amount,
		total,
		expectedCash: total - pph23Amount
	};
}

/** "INV/BEF/2026/10/007": year and month of the issue date, sequence per month */
export function formatInvoiceNumber(issueDate: string, seq: number) {
	return `INV/BEF/${issueDate.slice(0, 4)}/${issueDate.slice(5, 7)}/${String(seq).padStart(3, '0')}`;
}
