import { describe, expect, it } from 'vitest';
import { terbilang, terbilangRupiah } from './terbilang';

describe('terbilang', () => {
	it.each([
		[0, 'nol'],
		[1, 'satu'],
		[10, 'sepuluh'],
		[11, 'sebelas'],
		[12, 'dua belas'],
		[19, 'sembilan belas'],
		[20, 'dua puluh'],
		[21, 'dua puluh satu'],
		[100, 'seratus'],
		[101, 'seratus satu'],
		[111, 'seratus sebelas'],
		[250, 'dua ratus lima puluh'],
		[1000, 'seribu'],
		[1001, 'seribu satu'],
		[1100, 'seribu seratus'],
		[2000, 'dua ribu'],
		[11_000, 'sebelas ribu'],
		[100_000, 'seratus ribu'],
		[101_000, 'seratus satu ribu'],
		[1_000_000, 'satu juta'],
		[1_001_000, 'satu juta seribu'],
		[65_490_000, 'enam puluh lima juta empat ratus sembilan puluh ribu'],
		[1_000_000_000, 'satu miliar'],
		[2_500_000_000_000, 'dua triliun lima ratus miliar']
	])('%d → %s', (n, words) => {
		expect(terbilang(n)).toBe(words);
	});

	it('rejects fractions and capitalises the rupiah form', () => {
		expect(() => terbilang(1.5)).toThrow();
		expect(terbilangRupiah(17_760_000)).toBe('Tujuh belas juta tujuh ratus enam puluh ribu rupiah');
	});
});
