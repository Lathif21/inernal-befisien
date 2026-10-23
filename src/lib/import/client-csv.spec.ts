import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS, parseClientCsv, parseDue, templateCsv } from './client-csv';

const header = IMPORT_COLUMNS.join(',');
/** Build a CSV row from named cells (others empty) */
const row = (cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>) =>
	IMPORT_COLUMNS.map((c) => {
		const v = cells[c] ?? '';
		return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
	}).join(',');
const csv = (...rows: string[]) => [header, ...rows].join('\n');

describe('parseClientCsv', () => {
	it('accepts the downloadable template row', () => {
		const { lines, fileErrors } = parseClientCsv(templateCsv());
		expect(fileErrors).toEqual([]);
		expect(lines).toHaveLength(1);
		expect(lines[0].errors).toEqual([]);
		expect(lines[0].row).toEqual({
			clientName: 'PT Sinar Energi Nusantara',
			industry: 'energy',
			city: 'Surabaya',
			source: 'referral',
			contact: {
				name: 'Budi Santoso',
				position: 'Direktur Operasional',
				phone: '0812-3456-7890',
				email: 'budi@sinarenergi.co.id'
			},
			deal: {
				title: 'AI Monitoring PLTS',
				serviceType: 'energy_ai',
				stage: 'proposal',
				value: 85_000_000,
				nextAction: { title: 'Follow up proposal via WA', due: '2026-10-24T10:00' }
			},
			notes: 'Kenalan dari pameran MFS 2026'
		});
	});

	it('flags the docs template placeholders instead of importing them', () => {
		const text = readFileSync('docs/import-template.csv', 'utf8');
		const [line] = parseClientCsv(text).lines;
		expect(line.row).toBeNull();
		expect(line.errors.join(' ')).toMatch(/Ganti contoh dalam \[ \]/);
	});

	it('lists every problem of a row with its line number', () => {
		const { lines } = parseClientCsv(
			csv(
				row({
					client_name: 'PT Valid',
					industry: 'Energy',
					deal_title: 'Deal A',
					deal_stage: 'Lead'
				}),
				row({
					client_name: 'X',
					industry: 'mining',
					contact_phone: '12',
					deal_title: 'Deal B',
					deal_value: '85jt',
					next_action: 'Telepon',
					next_action_due: 'besok'
				}),
				row({ client_name: 'PT Tanpa Deal', next_action: 'Telepon', next_action_due: '2026-10-24' })
			)
		);
		expect(lines.map((l) => [l.line, l.row !== null])).toEqual([
			[2, true],
			[3, false],
			[4, false]
		]);
		expect(lines[0].row).toMatchObject({ industry: 'energy', deal: { stage: 'lead' } });
		expect(lines[1].errors).toEqual([
			'client_name wajib diisi (min. 2 karakter).',
			'industry "mining" tidak dikenal. Pilih: manufacturing, energy, logistics, finance, education, other.',
			'Isi contact_name untuk data kontak di baris ini.',
			'next_action_due "besok" harus YYYY-MM-DD atau YYYY-MM-DD HH:MM.',
			'deal_stage wajib diisi jika ada deal_title.',
			'deal_value "85jt" harus angka saja, contoh 85000000.'
		]);
		expect(lines[2].errors).toEqual([
			'next_action butuh deal_title (langkah selalu milik sebuah deal).'
		]);
	});

	it('reads Excel exports: semicolons, BOM, quoted notes, Rp amounts, date-only due', () => {
		const text =
			String.fromCharCode(0xfeff) +
			[
				IMPORT_COLUMNS.join(';'),
				'CV Maju;manufacturing;Bekasi;;Sari;;+62 812 1111 2222;SARI@MAJU.CO.ID;Otomasi gudang;automation;meeting;Rp 120.000.000;Demo sistem;2026-11-02;"Catatan; dengan titik koma"'
			].join('\r\n');
		const { lines, fileErrors } = parseClientCsv(text);
		expect(fileErrors).toEqual([]);
		expect(lines[0].errors).toEqual([]);
		expect(lines[0].row).toMatchObject({
			contact: { email: 'sari@maju.co.id', phone: '+62 812 1111 2222' },
			deal: { value: 120_000_000, nextAction: { due: '2026-11-02T09:00' } },
			notes: 'Catatan; dengan titik koma'
		});
	});

	it('warns but keeps a lost deal that has a next action', () => {
		const [line] = parseClientCsv(
			csv(
				row({
					client_name: 'PT Batal',
					deal_title: 'Deal lama',
					deal_stage: 'lost',
					next_action: 'Hubungi lagi',
					next_action_due: '2026-12-01'
				})
			)
		).lines;
		expect(line.errors).toEqual([]);
		expect(line.warnings).toHaveLength(1);
		expect(line.row?.deal?.nextAction).toBeNull();
	});

	it('rejects files without the client_name column, empty files and impossible dates', () => {
		expect(parseClientCsv('nama,kota\nA,B').fileErrors[0]).toMatch(/client_name tidak ditemukan/);
		expect(parseClientCsv(header).fileErrors).toEqual(['File tidak berisi baris data.']);
		const [bad] = parseClientCsv(
			csv(
				row({
					client_name: 'PT A',
					deal_title: 'Deal',
					deal_stage: 'lead',
					next_action: 'Telepon',
					next_action_due: '2026-02-30'
				})
			)
		).lines;
		expect(bad.errors[0]).toMatch(/next_action_due/);
		expect(
			parseClientCsv(`${header},kolom_lain\n${row({ client_name: 'PT A' })},x`).unknownColumns
		).toEqual(['kolom_lain']);
	});
});

describe('parseDue (dates as Excel writes them)', () => {
	it('reads ISO, US and Indonesian Excel formats', () => {
		expect(parseDue('2026-10-24 10:00')).toEqual({ due: '2026-10-24T10:00' });
		expect(parseDue('2026-10-24')).toEqual({ due: '2026-10-24T09:00' });
		expect(parseDue('10/24/2026 10:00')).toEqual({ due: '2026-10-24T10:00' });
		expect(parseDue('24/10/2026 9.30')).toEqual({ due: '2026-10-24T09:30' });
		expect(parseDue('24/10/2026 14:05:00')).toEqual({ due: '2026-10-24T14:05' });
		expect(parseDue('5/5/2026')).toEqual({ due: '2026-05-05T09:00' });
	});

	it('refuses ambiguous and impossible dates with a hint', () => {
		expect(parseDue('03/04/2026')).toEqual({
			error:
				'next_action_due "03/04/2026" bisa dibaca dua cara (3/4). Tulis sebagai 2026-04-03 atau 2026-03-04.'
		});
		expect('error' in parseDue('31/02/2026')).toBe(true);
		expect('error' in parseDue('2026-10-24 25:00')).toBe(true);
	});

	it('explains phone numbers that Excel turned into 6.28E+11', () => {
		const [line] = parseClientCsv(
			csv(row({ client_name: 'PT A', contact_name: 'Budi', contact_phone: '6.28123E+11' }))
		).lines;
		expect(line.errors[0]).toMatch(/angka ilmiah/);
	});
});
