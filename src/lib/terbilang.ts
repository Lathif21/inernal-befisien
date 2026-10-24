// Indonesian number words for the invoice PDF: 65_490_000 → "enam puluh lima juta empat ratus sembilan puluh ribu".

const ONES = [
	'',
	'satu',
	'dua',
	'tiga',
	'empat',
	'lima',
	'enam',
	'tujuh',
	'delapan',
	'sembilan',
	'sepuluh',
	'sebelas'
];
const SCALES = ['', 'ribu', 'juta', 'miliar', 'triliun'];

function belowThousand(n: number): string {
	if (n < 12) return ONES[n];
	if (n < 20) return `${ONES[n - 10]} belas`;
	if (n < 100) return [`${ONES[Math.floor(n / 10)]} puluh`, ONES[n % 10]].filter(Boolean).join(' ');
	const hundreds = Math.floor(n / 100) === 1 ? 'seratus' : `${ONES[Math.floor(n / 100)]} ratus`;
	return [hundreds, belowThousand(n % 100)].filter(Boolean).join(' ');
}

/** Whole numbers from 0 up to 999 triliun */
export function terbilang(n: number): string {
	if (!Number.isSafeInteger(n)) throw new Error(`terbilang: ${n} is not a whole number`);
	if (n < 0) return `minus ${terbilang(-n)}`;
	if (n === 0) return 'nol';
	const words: string[] = [];
	for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
		const group = n % 1000;
		if (!group) continue;
		if (scale >= SCALES.length) throw new Error('terbilang: number too large');
		// 1000 is "seribu", not "satu ribu"
		const part = scale === 1 && group === 1 ? 'seribu' : [belowThousand(group), SCALES[scale]];
		words.unshift(...[part].flat().filter(Boolean));
	}
	return words.join(' ');
}

/** "Enam puluh lima juta rupiah" */
export function terbilangRupiah(amount: number): string {
	const words = `${terbilang(amount)} rupiah`;
	return words[0].toUpperCase() + words.slice(1);
}
