// Telegram input (P2-10): turn one chat message or voice-note transcript into one draft. The lead
// fields are the CSV import columns (docs/07-IMPORT-GUIDE.md). A .ts file so the Trigger.dev bundle
// includes it.
import {
	CLIENT_SOURCE_LABELS,
	CLIENT_SOURCES,
	DEAL_STAGE_META,
	DEAL_STAGES,
	INDUSTRIES,
	INDUSTRY_LABELS,
	MANUAL_ACTIVITY_TYPES,
	SERVICE_TYPE_LABELS,
	SERVICE_TYPES
} from '../../../constants';

const choices = (values: readonly string[], labels: Record<string, string>) =>
	values.map((v) => `"${v}" (${labels[v]})`).join(', ');

const STAGE_LABELS = Object.fromEntries(DEAL_STAGES.map((s) => [s, DEAL_STAGE_META[s].label]));

export const INPUT_INTENTS = ['lead', 'step', 'move', 'plan', 'note', 'unknown'] as const;
export type InputIntent = (typeof INPUT_INTENTS)[number];

export const INPUT_SYSTEM = `Anda adalah asisten input data untuk CRM Befisien Technologies (software house di Indonesia).
Anggota tim mengirim satu pesan atau voice note (sudah ditranskrip) lewat Telegram. Ubah pesan itu
menjadi SATU draf data. Pengirim memeriksa draf lalu menekan Simpan; Anda tidak menyimpan apa pun.

## Jenis draf (intent)

- "lead": klien atau prospek baru, kontaknya, dan/atau deal baru di Pipeline. Isi kolom yang sama
  dengan template impor CSV: client_name, industry, city, source, contact_name, contact_position,
  contact_phone, contact_email, deal_title, service_type, deal_stage, deal_value, next_action,
  next_action_due, notes. Jika kliennya sudah ada di \`klien\`, isi existing_client dengan ref-nya
  (contoh "K3"); jika baru, existing_client "".
- "step": langkah, tugas atau jadwal untuk deal atau proyek yang sudah ada di \`kartu\`
  (target, step_title, step_due).
- "move": deal yang sudah ada pindah tahap (target = ref deal, to_stage; lost_reason jika batal).
- "plan": rencana strategi untuk deal atau proyek yang sudah ada (target, plan_goal,
  plan_target_date, plan_steps). plan_steps adalah daftar teks, satu per langkah, dengan format
  "YYYY-MM-DDTHH:mm | judul langkah" (atau "YYYY-MM-DD | judul langkah" jika tanpa jam), misalnya
  "2026-10-26T10:00 | Kirim build UAT".
- "note": catatan, hasil telepon, meeting, WhatsApp atau email dengan klien yang sudah ada
  (target = ref klien, deal atau proyek; note_type, note_body).
- "unknown": pesan tidak berisi data untuk dicatat, atau terlalu tidak jelas. Tulis jawaban singkat
  di reply, misalnya apa yang kurang.

## Aturan

- Hanya gunakan fakta dari pesan. Jangan mengarang nama, nomor, angka, atau tanggal.
- Semua kolom yang tidak dipakai atau tidak disebut: string kosong "". plan_steps: [] jika kosong.
- target dan existing_client hanya boleh ref dari data (K…, D…, P…). Cocokkan nama dengan longgar
  ("Sinar Jaya" = "PT Sinar Jaya Abadi"). Jika cocok dengan lebih dari satu dan pesan tidak
  membedakannya, atau tidak ada yang cocok, isi target "" dan sebut pilihannya di reply.
- Untuk "step", "move" dan "plan", target harus deal (D…) atau proyek (P…). Jika pesan hanya
  menyebut klien dan klien itu punya tepat satu kartu, pakai kartu itu.
- Waktu dalam WIB. Tanggal dan jam: "YYYY-MM-DDTHH:mm"; jika tanpa jam: "YYYY-MM-DD". Hitung dari
  \`sekarang\`: "besok", "lusa", "Kamis" atau "Kamis depan" (Kamis terdekat setelah hari ini;
  "Senin depan" yang diucapkan hari Sabtu = lusa), "minggu depan" tanpa nama hari (Senin
  depan), "jam 2 siang" = 14:00.
- Uang dalam Rupiah utuh, hanya angka: "25 juta" → "25000000", "1,5 M" → "1500000000".
- industry: ${choices(INDUSTRIES, INDUSTRY_LABELS)}.
- source: ${choices(CLIENT_SOURCES, CLIENT_SOURCE_LABELS)}.
- service_type: ${choices(SERVICE_TYPES, SERVICE_TYPE_LABELS)}.
- deal_stage dan to_stage: ${choices(DEAL_STAGES, STAGE_LABELS)}. Deal baru tanpa tahap: "lead".
- note_type: ${MANUAL_ACTIVITY_TYPES.map((t) => `"${t}"`).join(', ')} (telepon = "call").
- deal_title: nama pekerjaannya, singkat (misalnya "Website company profile"), bukan nama klien.
- step_title, next_action, dan judul plan_steps: diawali kata kerja, maksimal 120 karakter.
- note_body: isi catatan yang rapi dan lengkap dari pesan, tanpa menambah fakta.
- notes (lead): hanya informasi lain yang tidak masuk kolom mana pun; jangan mengulang nilai,
  kontak, atau langkah. Kosongkan jika tidak ada.
- Nomor telepon dan email ditulis persis seperti di pesan.
- reply: kosong untuk draf yang lengkap; isi 1-2 kalimat untuk "unknown" atau jika target tidak
  bisa ditentukan. Sebut deal / proyek dengan namanya, jangan dengan ref (D1, P1, K1).

## Koreksi

Jika ada \`draf_sebelumnya\` dan pesan ini mengoreksi atau menambah draf itu ("nilainya 30 juta",
"jamnya jam 2", "tambah kontak Bu Rina"), isi revises_previous true dan kembalikan draf yang LENGKAP
setelah dikoreksi (intent sama, semua kolom lama tetap diisi). Jika pesan ini data baru,
revises_previous false.`;

const str = { type: 'string' } as const;
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: ['', ...values] }) as const;

const FIELDS = {
	intent: { type: 'string', enum: INPUT_INTENTS },
	revises_previous: { type: 'boolean' },
	// lead = the CSV import columns
	client_name: str,
	existing_client: str,
	industry: oneOf(INDUSTRIES),
	city: str,
	source: oneOf(CLIENT_SOURCES),
	contact_name: str,
	contact_position: str,
	contact_phone: str,
	contact_email: str,
	deal_title: str,
	service_type: oneOf(SERVICE_TYPES),
	deal_stage: oneOf(DEAL_STAGES),
	deal_value: str,
	next_action: str,
	next_action_due: str,
	notes: str,
	// step / move / plan / note
	target: str,
	step_title: str,
	step_due: str,
	to_stage: oneOf(DEAL_STAGES),
	lost_reason: str,
	plan_goal: str,
	plan_target_date: str,
	/** "YYYY-MM-DDTHH:mm | title": MiniMax answers nested objects with plain strings anyway */
	plan_steps: { type: 'array', maxItems: 8, items: str },
	note_type: oneOf(MANUAL_ACTIVITY_TYPES),
	note_body: str,
	reply: str
} as const;

/** Every field is required (strict mode); "" = not given. Plain strings: MiniMax rejects nullable types. */
export const INPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: Object.keys(FIELDS),
	properties: FIELDS
} as const;

export type InputAnswer = {
	[K in keyof typeof FIELDS]: K extends 'intent'
		? InputIntent
		: K extends 'revises_previous'
			? boolean
			: K extends 'plan_steps'
				? string[]
				: string;
};

/** The user turn: the time, what the CRM has, an open draft, and the message itself */
export function inputUserMessage(input: {
	now: string;
	clients: string[];
	cards: string[];
	previous: Record<string, unknown> | null;
	source: 'text' | 'voice';
	text: string;
}) {
	return [
		`sekarang: ${input.now}`,
		'',
		'klien (ref | nama):',
		...(input.clients.length ? input.clients : ['(belum ada)']),
		'',
		'kartu (ref | klien | judul | tahap):',
		...(input.cards.length ? input.cards : ['(belum ada)']),
		'',
		input.previous
			? `draf_sebelumnya (JSON):\n${JSON.stringify(input.previous)}`
			: 'draf_sebelumnya: tidak ada',
		'',
		input.source === 'voice' ? 'Transkrip voice note:' : 'Pesan:',
		input.text
	].join('\n');
}
