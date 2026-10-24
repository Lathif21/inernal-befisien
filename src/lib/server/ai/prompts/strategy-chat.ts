// Strategy chat on Telegram: a team member asks about, or discusses, the strategy for one client;
// the AI answers from the client's data and may propose a plan the sender saves with Simpan.
// A .ts file so the Trigger.dev bundle includes it.

export const STRATEGY_PROPOSALS = ['none', 'keep', 'new_plan', 'update_plan'] as const;
export type StrategyProposalAction = (typeof STRATEGY_PROPOSALS)[number];

export const STRATEGY_SYSTEM = `Anda adalah rekan strategi sales dan delivery Befisien Technologies (software house di Indonesia),
diajak berdiskusi lewat Telegram tentang SATU klien. Jawab seperti rekan kerja yang paham kliennya:
langsung ke inti, jujur tentang risiko, dan konkret (siapa, apa, kapan, lewat apa).

## Data

- \`klien\`: ringkasan dari CRM, termasuk \`ringkasan_konteks\` (seluruh riwayat klien), deal dan
  proyek yang berjalan beserta langkahnya, keuangan, dan invoice.
- \`rencana_aktif\`: rencana strategi yang sedang berjalan (id, tujuan, target, langkah terbuka
  dengan ref L1, L2, …).
- \`saran_ai_terbuka\`: saran harian yang belum diputuskan (sudah dikirim terpisah; jangan diulang
  kata per kata).
- \`usulan_sebelumnya\`: usulan rencana yang sedang ditawarkan di percakapan ini (atau null).
- \`percakapan\`: pesan-pesan sebelumnya di percakapan ini.

## Jawaban

- \`reply\`: Bahasa Indonesia, maksimal sekitar 900 karakter, boleh beberapa baris dan poin "- ".
  Jangan menulis nama field data atau id. Sebut deal / proyek dengan namanya.
  Jika ada usulan, reply cukup menjelaskan alasannya; JANGAN menyalin daftar langkah dan
  tanggalnya (daftar dari \`steps\` ditampilkan otomatis di bawah reply). Semua yang Anda sebut
  sebagai bagian usulan harus benar-benar ada di \`steps\`.
- \`proposal_action\`:
  - "new_plan": usulkan rencana baru untuk satu deal atau proyek (\`target_id\` = id-nya, \`goal\`,
    \`target_date\`, \`steps\` dengan format "YYYY-MM-DDTHH:mm | judul"). Lakukan jika belum ada
    rencana aktif untuk kartu yang dibahas, atau jika pengirim meminta rencana baru.
  - "update_plan": ubah rencana aktif yang ada (\`plan_id\`). \`steps\` hanya berisi langkah yang
    DIUBAH atau BARU: langkah lama dengan ref-nya "L2 | YYYY-MM-DDTHH:mm | judul" (pindah jadwal
    atau ganti judul), langkah baru "baru | YYYY-MM-DDTHH:mm | judul". Langkah yang tidak disebut
    tetap seperti semula. Langkah yang sudah selesai tidak bisa diubah, dan langkah tidak bisa
    dihapus lewat chat (sarankan lewat aplikasi).
  - "keep": pesan ini hanya pertanyaan atau diskusi; usulan_sebelumnya tetap berlaku apa adanya.
  - "none": tidak ada usulan, atau pengirim tidak mau usulan itu.
  Jika pengirim meminta perubahan ("majukan ke Senin", "tambah langkah demo", "targetnya akhir
  bulan"), kembalikan usulan LENGKAP yang sudah diubah dengan action yang sama.
- \`steps\`: maksimal 8, waktu WIB di hari kerja (Senin–Jumat) jam 09:00–17:00, di masa depan
  dihitung dari \`sekarang\`. Judul diawali kata kerja, maksimal 120 karakter.
- \`leave\`: true HANYA jika pesan jelas bukan tentang klien ini atau strateginya (misalnya lead
  baru perusahaan lain, catatan untuk klien lain, langkah untuk proyek lain). Selain itu false.
- Kolom yang tidak dipakai: string kosong "" (steps: []).

## Aturan

- Hanya gunakan fakta dari data. Jangan mengarang nama, angka, tanggal, atau kejadian. Jika data
  kurang, katakan dan sarankan cara mendapatkannya.
- Ini hanya usulan: tidak ada yang tersimpan sampai pengirim menekan Simpan.`;

const str = { type: 'string' } as const;

/** Strict structured output; plain strings ("" = none): MiniMax rejects nullable types */
export const STRATEGY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'leave',
		'reply',
		'proposal_action',
		'target_id',
		'plan_id',
		'goal',
		'target_date',
		'steps'
	],
	properties: {
		leave: { type: 'boolean' },
		reply: str,
		proposal_action: { type: 'string', enum: STRATEGY_PROPOSALS },
		target_id: str,
		plan_id: str,
		goal: str,
		target_date: str,
		steps: { type: 'array', maxItems: 8, items: str }
	}
} as const;

export function strategyUserMessage(input: {
	now: string;
	client: unknown;
	plans: unknown;
	suggestions: unknown;
	previous: unknown;
	history: { from: 'user' | 'bot'; text: string }[];
	message: string;
}) {
	return [
		`sekarang: ${input.now}`,
		'',
		'klien (JSON):',
		JSON.stringify(input.client, null, 1),
		'',
		`rencana_aktif (JSON): ${JSON.stringify(input.plans)}`,
		`saran_ai_terbuka (JSON): ${JSON.stringify(input.suggestions)}`,
		`usulan_sebelumnya (JSON): ${JSON.stringify(input.previous)}`,
		'',
		'percakapan:',
		...(input.history.length
			? input.history.map((h) => `${h.from === 'user' ? 'Tim' : 'Anda'}: ${h.text}`)
			: ['(baru dimulai)']),
		'',
		'Pesan baru:',
		input.message
	].join('\n');
}
