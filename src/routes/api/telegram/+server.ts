// Telegram webhook (docs/04-ARCHITECTURE.md "Linking Telegram"). Public route: Telegram proves
// itself with the secret header set by setWebhook. Always answers 200 for valid calls, otherwise
// Telegram keeps retrying the same update.
import { timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { TELEGRAM_WEBHOOK_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { linkTelegram, unlinkTelegram } from '#lib/server/services/telegram-link.ts';
import type { RequestHandler } from './$types';

type Update = {
	message?: { text?: string; chat?: { id: number; type: string } };
};

function sameSecret(given: string, expected: string) {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Answer in the webhook response itself (Telegram runs it as a sendMessage call) */
const reply = (chatId: number, text: string) =>
	json({ method: 'sendMessage', chat_id: chatId, text, parse_mode: 'HTML' });

const HOW_TO =
	'Untuk menghubungkan akun, buka Befisien CRM → Pengaturan → Telegram, lalu klik <b>Hubungkan Telegram</b>.';

export const POST: RequestHandler = async ({ request }) => {
	const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
	if (!TELEGRAM_WEBHOOK_SECRET || !sameSecret(secret, TELEGRAM_WEBHOOK_SECRET))
		return new Response('Forbidden', { status: 401 });

	const update = (await request.json().catch(() => null)) as Update | null;
	const chat = update?.message?.chat;
	const text = update?.message?.text?.trim();
	// Only private chats with text; anything else is acknowledged and ignored
	if (!chat || chat.type !== 'private' || !text) return json({ ok: true });

	const [command, arg] = text.split(/\s+/, 2);
	if (command === '/start' && arg) {
		const linked = await linkTelegram(db, arg, String(chat.id));
		return reply(
			chat.id,
			linked
				? `Terhubung. Halo ${linked.name.split(' ')[0]}, ringkasan harian Befisien akan dikirim ke sini setiap pukul 07:30 WIB. Kirim /stop untuk berhenti.`
				: `Kode tidak valid atau sudah kedaluwarsa. ${HOW_TO}`
		);
	}
	if (command === '/start') return reply(chat.id, `Halo! Ini bot Befisien CRM. ${HOW_TO}`);
	if (command === '/stop') {
		const rows = await unlinkTelegram(db, { chatId: String(chat.id) });
		return reply(
			chat.id,
			rows.length
				? 'Telegram diputus. Ringkasan harian tidak dikirim ke sini lagi.'
				: 'Chat ini belum terhubung ke akun Befisien CRM.'
		);
	}
	return reply(chat.id, `Bot ini hanya mengirim ringkasan harian. ${HOW_TO}`);
};
