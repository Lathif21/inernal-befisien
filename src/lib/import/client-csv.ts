// Client CSV import (docs/07-IMPORT-GUIDE.md): parse with papaparse, validate every row, and say
// exactly what is wrong in Bahasa Indonesia. Pure and client-safe; services/import.ts re-runs it
// on the server before writing anything.
import Papa from 'papaparse';
import { z } from 'zod';
import {
	CLIENT_SOURCES,
	DEAL_STAGES,
	INDUSTRIES,
	SERVICE_TYPES,
	type ClientSource,
	type DealStage,
	type Industry,
	type ServiceType
} from '../constants';
import { phoneNormalize } from '../format';

export const IMPORT_COLUMNS = [
	'client_name',
	'industry',
	'city',
	'source',
	'contact_name',
	'contact_position',
	'contact_phone',
	'contact_email',
	'deal_title',
	'service_type',
	'deal_stage',
	'deal_value',
	'next_action',
	'next_action_due',
	'notes'
] as const;
type Column = (typeof IMPORT_COLUMNS)[number];

/** Keeps the file small enough to preview and import in one request */
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 1_000_000;

/** One valid row, ready for services/import.ts */
export type ImportRow = {
	clientName: string;
	industry: Industry | null;
	city: string | null;
	source: ClientSource | null;
	contact: { name: string; position: string; phone: string; email: string } | null;
	deal: {
		title: string;
		serviceType: ServiceType | null;
		stage: DealStage;
		value: number | null;
		/** First step: title and WIB wall time `yyyy-MM-ddTHH:mm` */
		nextAction: { title: string; due: string } | null;
	} | null;
	notes: string | null;
};

export type ParsedLine = {
	/** Line number in the file (the header is line 1) */
	line: number;
	/** The cells as written, for the preview */
	raw: Partial<Record<Column, string>>;
	row: ImportRow | null;
	errors: string[];
	/** Not blocking, e.g. a next action that a lost deal does not need */
	warnings: string[];
};

export type ParsedFile = {
	lines: ParsedLine[];
	/** Problems with the file itself (empty, no client_name column, too many rows) */
	fileErrors: string[];
	/** Columns that are not part of the template; they are ignored */
	unknownColumns: string[];
};

/** Byte order mark that Excel puts in front of "CSV UTF-8" files */
const BOM = String.fromCharCode(0xfeff);
const ISO_DUE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})[:.](\d{2}))?$/;
/** What Excel writes after opening the file: 10/24/2026 10:00 (US) or 24/10/2026 10.00 (ID) */
const SLASH_DUE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})[:.](\d{2})(?::\d{2})?)?$/;
const isRealDay = (y: number, m: number, day: number) => {
	const t = new Date(Date.UTC(y, m - 1, day));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * next_action_due → WIB wall time `yyyy-MM-ddTHH:mm` (date only = 09:00). Slash dates are read
 * day/month or month/day when only one reading is possible; 03/04/2026 is refused as ambiguous.
 */
export function parseDue(text: string): { due: string } | { error: string } {
	const formats = 'YYYY-MM-DD atau YYYY-MM-DD HH:MM';
	let y: number, mo: number, d: number, h: number, mi: number;
	const iso = ISO_DUE.exec(text);
	const slash = SLASH_DUE.exec(text);
	if (iso) {
		[y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
		[h, mi] = [Number(iso[4] ?? 9), Number(iso[5] ?? 0)];
	} else if (slash) {
		const [a, b] = [Number(slash[1]), Number(slash[2])];
		y = Number(slash[3]);
		if (a > 12 && b <= 12) [d, mo] = [a, b];
		else if (b > 12 && a <= 12) [mo, d] = [a, b];
		else if (a === b) [d, mo] = [a, b];
		else
			return {
				error: `next_action_due "${text}" bisa dibaca dua cara (${a}/${b}). Tulis sebagai ${y}-${pad(b)}-${pad(a)} atau ${y}-${pad(a)}-${pad(b)}.`
			};
		[h, mi] = [Number(slash[4] ?? 9), Number(slash[5] ?? 0)];
	} else return { error: `next_action_due "${text}" harus ${formats}.` };
	if (!isRealDay(y, mo, d) || h > 23 || mi > 59)
		return { error: `next_action_due "${text}" bukan tanggal yang valid (${formats}).` };
	return { due: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}` };
}
const email = z.email();

/** "Rp 85.000.000" / "85 000 000" / "85000000" → 85000000; anything else → NaN */
function money(v: string) {
	const cleaned = v.replace(/^rp\.?\s*/i, '').replace(/[.\s]/g, '');
	return /^\d{1,15}$/.test(cleaned) ? Number(cleaned) : NaN;
}

function validate(raw: Partial<Record<Column, string>>): Omit<ParsedLine, 'line' | 'raw'> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const v = (c: Column) => (raw[c] ?? '').trim();
	const lower = (c: Column) => v(c).toLowerCase();

	// Template placeholders such as "[Nama Klien Contoh]" are not data
	const placeholders = IMPORT_COLUMNS.filter((c) => /^\[.*\]$/.test(v(c)));
	if (placeholders.length)
		errors.push(`Ganti contoh dalam [ ] dengan data asli (${placeholders.join(', ')}).`);

	const clientName = v('client_name');
	if (clientName.length < 2) errors.push('client_name wajib diisi (min. 2 karakter).');
	else if (clientName.length > 120) errors.push('client_name maksimal 120 karakter.');

	const pick = <T extends string>(c: Column, allowed: readonly T[]) => {
		const value = lower(c);
		if (!value) return null;
		if ((allowed as readonly string[]).includes(value)) return value as T;
		errors.push(`${c} "${v(c)}" tidak dikenal. Pilih: ${allowed.join(', ')}.`);
		return null;
	};
	const industry = pick('industry', INDUSTRIES);
	const source = pick('source', CLIENT_SOURCES);
	const serviceType = pick('service_type', SERVICE_TYPES);

	if (v('city').length > 80) errors.push('city maksimal 80 karakter.');
	if (v('notes').length > 5000) errors.push('notes maksimal 5000 karakter.');

	// Contact
	let contact: ImportRow['contact'] = null;
	const contactFields = ['contact_position', 'contact_phone', 'contact_email'] as const;
	if (v('contact_name')) {
		if (v('contact_name').length < 2) errors.push('contact_name minimal 2 karakter.');
		if (/e\+/i.test(v('contact_phone')))
			errors.push(
				`contact_phone "${v('contact_phone')}" diubah Excel menjadi angka ilmiah. Format kolom sebagai Teks, atau tulis dengan tanda strip (0812-3456-7890).`
			);
		else if (v('contact_phone') && !phoneNormalize(v('contact_phone')))
			errors.push(`contact_phone "${v('contact_phone')}" bukan nomor yang valid.`);
		if (v('contact_email') && !email.safeParse(lower('contact_email')).success)
			errors.push(`contact_email "${v('contact_email')}" bukan email yang valid.`);
		contact = {
			name: v('contact_name'),
			position: v('contact_position'),
			phone: v('contact_phone'),
			email: lower('contact_email')
		};
	} else if (contactFields.some((c) => v(c))) {
		errors.push('Isi contact_name untuk data kontak di baris ini.');
	}

	// Deal and its first step
	let deal: ImportRow['deal'] = null;
	let nextAction: { title: string; due: string } | null = null;
	if (v('next_action')) {
		if (!v('next_action_due')) errors.push('next_action_due wajib diisi jika ada next_action.');
		else {
			const due = parseDue(v('next_action_due'));
			if ('error' in due) errors.push(due.error);
			else nextAction = { title: v('next_action'), due: due.due };
		}
		if (v('next_action').length < 3) errors.push('next_action minimal 3 karakter.');
	}
	if (v('deal_title')) {
		const stage = pick('deal_stage', DEAL_STAGES);
		if (!v('deal_stage')) errors.push('deal_stage wajib diisi jika ada deal_title.');
		let value: number | null = null;
		if (v('deal_value')) {
			value = money(v('deal_value'));
			if (Number.isNaN(value)) {
				errors.push(`deal_value "${v('deal_value')}" harus angka saja, contoh 85000000.`);
				value = null;
			}
		}
		if (v('deal_title').length < 3) errors.push('deal_title minimal 3 karakter.');
		if (stage === 'lost' && nextAction) {
			warnings.push('Deal batal tidak butuh langkah berikutnya; next_action diabaikan.');
			nextAction = null;
		}
		if (stage) deal = { title: v('deal_title'), serviceType, stage, value, nextAction };
	} else {
		const dealOnly = (['deal_stage', 'deal_value', 'service_type', 'next_action'] as const).filter(
			(c) => v(c)
		);
		if (dealOnly.length)
			errors.push(`${dealOnly.join(', ')} butuh deal_title (langkah selalu milik sebuah deal).`);
	}

	if (errors.length) return { row: null, errors, warnings };
	return {
		row: {
			clientName,
			industry,
			city: v('city') || null,
			source,
			contact,
			deal,
			notes: v('notes') || null
		},
		errors,
		warnings
	};
}

/** Parse and validate a client CSV. Delimiter (comma or semicolon from Excel) is detected. */
export function parseClientCsv(text: string): ParsedFile {
	const result = Papa.parse<Record<string, string>>(text.startsWith(BOM) ? text.slice(1) : text, {
		header: true,
		skipEmptyLines: 'greedy',
		transformHeader: (h) => h.trim().toLowerCase()
	});
	const headers = result.meta.fields ?? [];
	const fileErrors: string[] = [];
	if (!headers.includes('client_name'))
		fileErrors.push('Kolom client_name tidak ditemukan. Gunakan baris judul dari template.');
	if (result.data.length === 0) fileErrors.push('File tidak berisi baris data.');
	if (result.data.length > MAX_IMPORT_ROWS)
		fileErrors.push(`Maksimal ${MAX_IMPORT_ROWS} baris per impor; file ini ${result.data.length}.`);
	const unknownColumns = headers.filter(
		(h) => h && !(IMPORT_COLUMNS as readonly string[]).includes(h)
	);
	if (fileErrors.length) return { lines: [], fileErrors, unknownColumns };

	// Papaparse reports broken quoting per row
	const rowErrors = new Map<number, string>();
	for (const e of result.errors)
		if (e.row !== undefined) rowErrors.set(e.row, `Format CSV rusak: ${e.message}`);

	const lines = result.data.map((cells, i) => {
		const raw: Partial<Record<Column, string>> = {};
		for (const c of IMPORT_COLUMNS) if (cells[c] !== undefined) raw[c] = String(cells[c]);
		const checked = validate(raw);
		const broken = rowErrors.get(i);
		return {
			// header is line 1; this ignores blank lines skipped in between (rare in exports)
			line: i + 2,
			raw,
			...checked,
			row: broken ? null : checked.row,
			errors: broken ? [broken, ...checked.errors] : checked.errors
		};
	});
	return { lines, fileErrors, unknownColumns };
}

/** The downloadable template: header plus one valid example row (docs/07-IMPORT-GUIDE.md) */
export function templateCsv() {
	const example = [
		'PT Sinar Energi Nusantara',
		'energy',
		'Surabaya',
		'referral',
		'Budi Santoso',
		'Direktur Operasional',
		'0812-3456-7890',
		'budi@sinarenergi.co.id',
		'AI Monitoring PLTS',
		'energy_ai',
		'proposal',
		'85000000',
		'Follow up proposal via WA',
		'2026-10-24 10:00',
		'Kenalan dari pameran MFS 2026'
	];
	return Papa.unparse({ fields: [...IMPORT_COLUMNS], data: [example] }) + '\r\n';
}
