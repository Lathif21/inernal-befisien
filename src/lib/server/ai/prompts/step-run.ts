// Executable steps on Telegram (P2-13): the team completes or corrects a Jalankan preview by chat
// ("industrinya logistik, kota Surabaya", "jumlahnya 12 juta"). The AI returns the action's fields
// with the message applied. Flat strings only: MiniMax ignores nested objects and nullable types.
// A .ts file so the Trigger.dev bundle includes it.
import {
	CLIENT_SOURCE_LABELS,
	CLIENT_SOURCES,
	DEAL_STAGE_META,
	INDUSTRIES,
	INDUSTRY_LABELS,
	OPEN_DEAL_STAGES,
	PAYMENT_METHOD_LABELS,
	PAYMENT_METHODS,
	SERVICE_TYPE_LABELS,
	SERVICE_TYPES
} from '../../../constants';

const choices = (values: readonly string[], labels: Record<string, string>) =>
	values.map((v) => `"${v}" (${labels[v]})`).join(', ');

const STAGE_LABELS = Object.fromEntries(OPEN_DEAL_STAGES.map((s) => [s, DEAL_STAGE_META[s].label]));

export const STEP_RUN_SYSTEM = `Anda membantu tim Befisien Technologies mengisi SATU aksi CRM yang menunggu
tombol Simpan di Telegram. Diberi \`aksi\` (jenis dan nilai sekarang), \`sekarang\` (WIB), dan pesan
baru dari tim. Terapkan pesan itu ke nilai aksi.

## Jawaban

- \`leave\`: true HANYA jika pesan jelas bukan tentang aksi ini (lead baru, catatan atau langkah untuk
  klien lain, pertanyaan strategi). Jika true, kolom lain "".
- Kolom milik jenis aksi ini: salin nilai sekarang, lalu ubah yang disebut di pesan. "" berarti kosong.
  Kolom milik jenis lain: "".
- \`reply\`: satu kalimat pendek Bahasa Indonesia tentang yang diubah, atau "" jika tidak ada.

## Kolom per jenis

- update_client: industry (${choices(INDUSTRIES, INDUSTRY_LABELS)}), source
  (${choices(CLIENT_SOURCES, CLIENT_SOURCE_LABELS)}), city, website, notes (catatan umum
  tentang klien), context_add (fakta baru untuk Ringkasan konteks: kebutuhan, situasi, pengambil
  keputusan, anggaran; kalimat lengkap).
- create_deal: title, value (Rupiah, angka saja), service_type
  (${choices(SERVICE_TYPES, SERVICE_TYPE_LABELS)}), first_step_title, first_step_due.
- move_deal: to (${choices(OPEN_DEAL_STAGES.slice(1), STAGE_LABELS)}).
- record_payment: amount (Rupiah, angka saja), date (YYYY-MM-DD), method
  (${choices(PAYMENT_METHODS, PAYMENT_METHOD_LABELS)}).
- Semua jenis: next_title dan next_due (langkah berikutnya di kartu ini), hanya jika aksi sekarang
  sudah punya nilainya.
Waktu ditulis YYYY-MM-DDTHH:mm (WIB).

## Aturan

- Jangan mengarang data yang tidak disebut tim; yang tidak disebut tetap seperti nilai sekarang.
- Tanggal relatif ("besok", "Senin depan") dihitung dari \`sekarang\`. "20 juta" = 20000000,
  "1,5 jt" = 1500000.
- Pilihan (industry, source, service_type, to, method) harus salah satu kode di atas.`;

const str = { type: 'string' } as const;

/** The editable fields of every kind, flat */
export const STEP_RUN_FIELDS = [
	'industry',
	'source',
	'city',
	'website',
	'notes',
	'context_add',
	'title',
	'value',
	'service_type',
	'first_step_title',
	'first_step_due',
	'to',
	'amount',
	'date',
	'method',
	'next_title',
	'next_due'
] as const;
export type StepRunField = (typeof STEP_RUN_FIELDS)[number];

export const STEP_RUN_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['leave', 'reply', ...STEP_RUN_FIELDS],
	properties: {
		leave: { type: 'boolean' },
		reply: str,
		...Object.fromEntries(STEP_RUN_FIELDS.map((f) => [f, str]))
	}
} as const;

export function stepRunUserMessage(input: {
	now: string;
	kind: string;
	label: string;
	values: Partial<Record<StepRunField, string>>;
	message: string;
}) {
	return [
		`sekarang: ${input.now}`,
		'',
		`aksi (JSON): ${JSON.stringify({ jenis: input.kind, nama: input.label, nilai: input.values })}`,
		'',
		'Pesan baru:',
		input.message
	].join('\n');
}
