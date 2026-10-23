import { describe, expect, it } from 'vitest';
import { clientSchema, looksLikeUrl } from './client';

const valid = { name: 'PT Surya Daya Mandiri' };

function errorsOf(input: Record<string, unknown>) {
	const result = clientSchema.safeParse(input);
	return result.success
		? {}
		: Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('clientSchema', () => {
	it('accepts a name only and fills defaults', () => {
		const parsed = clientSchema.parse(valid);
		expect(parsed).toMatchObject({ id: '', status: 'prospect', industry: '', website: '' });
	});

	it('trims and requires a name of at least 2 characters', () => {
		expect(errorsOf({ name: '  A ' })).toEqual({ name: 'Nama klien minimal 2 karakter.' });
		expect(clientSchema.parse({ name: '  CV Garuda  ' }).name).toBe('CV Garuda');
	});

	it('only allows listed industries and sources, or empty', () => {
		expect(errorsOf({ ...valid, industry: 'mining' })).toEqual({
			industry: 'Pilih industri dari daftar.'
		});
		expect(errorsOf({ ...valid, industry: 'energy', source: 'apollo' })).toEqual({});
	});

	it('does not let the form set the archived status', () => {
		expect(errorsOf({ ...valid, status: 'archived' })).toHaveProperty('status');
	});

	it('checks NPWP digit count and website shape', () => {
		expect(errorsOf({ ...valid, npwp: '01.234.567.8-901.000' })).toEqual({});
		expect(errorsOf({ ...valid, npwp: '12345' })).toEqual({ npwp: 'NPWP harus 15 atau 16 digit.' });
		expect(errorsOf({ ...valid, website: 'bukan url' })).toEqual({
			website: 'Alamat website tidak valid.'
		});
	});

	it('requires the id to be empty or a UUID', () => {
		expect(errorsOf({ ...valid, id: '1; drop table client' })).toEqual({
			id: 'Klien tidak valid.'
		});
		expect(errorsOf({ ...valid, id: '6f1c1d4e-3b2a-4c5d-8e9f-0a1b2c3d4e5f' })).toEqual({});
	});
});

describe('looksLikeUrl', () => {
	it.each([
		['befisien.com', true],
		['https://befisien.com/tentang', true],
		['localhost', false],
		['ftp://befisien.com', false],
		['not a url', false]
	])('%s → %s', (value, expected) => {
		expect(looksLikeUrl(value)).toBe(expected);
	});
});
