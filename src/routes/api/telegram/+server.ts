// Telegram webhook (docs/04-ARCHITECTURE.md "Linking Telegram", "Telegram input"). Public route:
// Telegram proves itself with the secret header set by setWebhook. Always answers 200 for valid
// calls, otherwise Telegram keeps retrying the same update. Messages from linked users are queued
// on Trigger.dev (telegram-inbound) so this answers at once; Simpan / Batal are handled here.
import { timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { BETTER_AUTH_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	clearTelegramButtons,
	editTelegramMessage,
	sendTelegramMessage
} from '#lib/server/notify/telegram.ts';
import {
	BOT_HELP,
	cancelDraft,
	confirmDraft,
	MAX_VOICE_SECONDS,
	type DecideResult
} from '#lib/server/services/telegram-input.ts';
import { linkedUser, linkTelegram, unlinkTelegram } from '#lib/server/services/telegram-link.ts';
import {
	acceptSuggestionFromChat,
	dismissSuggestionFromChat
} from '#lib/server/services/telegram-strategy.ts';
import { startStepRun } from '#lib/server/services/telegram-step-run.ts';
import { queueTelegramInbound } from '#lib/server/trigger.ts';
import type { RequestHandler } from './$types';

type Chat = { id: number; type: string };
type Audio = { file_id: string; duration: number };
type Update = {
	update_id: number;
	message?: { text?: string; chat?: Chat; voice?: Audio; audio?: Audio };
	callback_query?: { id: string; data?: string; message?: { message_id: number; chat: Chat } };
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

const appUrl = BETTER_AUTH_URL ?? 'http://localhost:5173';
// s / c: Simpan / Batal a draft, a strategy proposal or a Jalankan preview; a / d: Terima / Abaikan
// a Saran AI; x: Jalankan a system-action step of a saved plan (P2-13)
const DRAFT_BUTTON = /^([scadx]):([0-9a-f-]{36})$/;

async function onButton(q: NonNullable<Update['callback_query']>) {
	const answer = (text: string) =>
		json({ method: 'answerCallbackQuery', callback_query_id: q.id, text });
	const msg = q.message;
	const m = DRAFT_BUTTON.exec(q.data ?? '');
	if (!msg || msg.chat.type !== 'private' || !m) return answer('Tombol ini tidak dikenal.');

	const chatId = String(msg.chat.id);
	const sender = await linkedUser(db, chatId);
	if (!sender) return answer('Chat ini belum terhubung ke Befisien CRM.');
	const token = TELEGRAM_BOT_TOKEN ?? '';
	if (m[1] === 'x') {
		const run = await startStepRun(
			db,
			{ stepId: m[2], chatId, userId: sender.id },
			{
				send: (html, buttons) => sendTelegramMessage(token, chatId, html, buttons),
				clearButtons: (messageId) => clearTelegramButtons(token, chatId, messageId)
			}
		);
		return answer(run.toast);
	}
	const input = { draftId: m[2], chatId };
	const suggestion = { suggestionId: m[2], userId: sender.id };
	const result: DecideResult =
		m[1] === 's'
			? await confirmDraft(db, { ...input, appUrl })
			: m[1] === 'c'
				? await cancelDraft(db, input)
				: m[1] === 'a'
					? await acceptSuggestionFromChat(db, suggestion)
					: await dismissSuggestionFromChat(db, suggestion);
	if (result.html)
		await editTelegramMessage(token, chatId, msg.message_id, result.html, result.buttons).catch(
			(e) => console.warn('[telegram] edit failed:', String(e))
		);
	return answer(result.toast);
}

export const POST: RequestHandler = async ({ request }) => {
	const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
	if (!TELEGRAM_WEBHOOK_SECRET || !sameSecret(secret, TELEGRAM_WEBHOOK_SECRET))
		return new Response('Forbidden', { status: 401 });

	const update = (await request.json().catch(() => null)) as Update | null;
	if (update?.callback_query) return onButton(update.callback_query);

	const message = update?.message;
	const chat = message?.chat;
	// Only private chats; anything else is acknowledged and ignored
	if (!update || !message || !chat || chat.type !== 'private') return json({ ok: true });
	const text = message.text?.trim() ?? '';
	const voice = message.voice ?? message.audio;
	if (!text && !voice) return reply(chat.id, 'Kirim pesan teks atau voice note.');

	const [command, arg] = text.split(/\s+/, 2);
	if (command === '/start' && arg) {
		const linked = await linkTelegram(db, arg, String(chat.id));
		return reply(
			chat.id,
			linked
				? `Terhubung. Halo ${linked.name.split(' ')[0]}, ringkasan harian Befisien akan dikirim ke sini setiap pukul 07:30 WIB.\n\n${BOT_HELP}`
				: `Kode tidak valid atau sudah kedaluwarsa. ${HOW_TO}`
		);
	}
	if (command === '/stop') {
		const rows = await unlinkTelegram(db, { chatId: String(chat.id) });
		return reply(
			chat.id,
			rows.length
				? 'Telegram diputus. Ringkasan harian tidak dikirim ke sini lagi.'
				: 'Chat ini belum terhubung ke akun Befisien CRM.'
		);
	}

	const sender = await linkedUser(db, String(chat.id));
	if (!sender) return reply(chat.id, `Halo! Ini bot Befisien CRM. ${HOW_TO}`);
	if (command === '/start' || command === '/bantuan' || command === '/help')
		return reply(chat.id, BOT_HELP);
	if (command.startsWith('/'))
		return reply(chat.id, `Perintah tidak dikenal. Kirim /bantuan untuk contoh.`);
	if (voice && voice.duration > MAX_VOICE_SECONDS)
		return reply(
			chat.id,
			`Voice note maksimal ${MAX_VOICE_SECONDS / 60} menit. Pecah menjadi beberapa pesan.`
		);

	try {
		await queueTelegramInbound(
			{
				chatId: String(chat.id),
				userId: sender.id,
				...(voice
					? { voice: { fileId: voice.file_id, duration: voice.duration } }
					: { text: text.slice(0, 4000) })
			},
			update.update_id
		);
	} catch (e) {
		console.error('[telegram] queue failed:', String(e));
		return reply(chat.id, 'Bot sedang tidak bisa memproses pesan. Coba lagi nanti.');
	}
	// The draft arrives from the task in a few seconds
	return json({ method: 'sendChatAction', chat_id: chat.id, action: 'typing' });
};
