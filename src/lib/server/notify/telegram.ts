// Telegram Bot API over plain HTTPS (docs/04-ARCHITECTURE.md). Relative imports only: shared with
// Trigger.dev. The token is passed in, so the app ($app/env/private) and the task (process.env)
// each supply their own.

/** Text for Telegram's HTML parse mode: only &, < and > need escaping */
export function escapeHtml(text: string) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegram(token: string, chatId: string, html: string) {
	await sendTelegramMessage(token, chatId, html);
}

/** One Bot API call; returns its `result` */
export async function telegramCall<T = unknown>(
	token: string,
	method: string,
	body: Record<string, unknown>
): Promise<T> {
	if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
	const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
	return ((await res.json()) as { result: T }).result;
}

/** A button under a message; `data` comes back in a callback_query (max 64 bytes) */
export type TelegramButton = { text: string; data: string };

const keyboard = (buttons: TelegramButton[]) => ({
	inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))]
});

/** sendMessage with optional buttons in one row; returns the new message's id */
export async function sendTelegramMessage(
	token: string,
	chatId: string,
	html: string,
	buttons: TelegramButton[] = []
) {
	const sent = await telegramCall<{ message_id: number }>(token, 'sendMessage', {
		chat_id: chatId,
		text: html,
		parse_mode: 'HTML',
		link_preview_options: { is_disabled: true },
		...(buttons.length ? { reply_markup: keyboard(buttons) } : {})
	});
	return sent.message_id;
}

/** Replace a message's text; its buttons are removed */
export async function editTelegramMessage(
	token: string,
	chatId: string,
	messageId: number,
	html: string
) {
	await telegramCall(token, 'editMessageText', {
		chat_id: chatId,
		message_id: messageId,
		text: html,
		parse_mode: 'HTML',
		link_preview_options: { is_disabled: true }
	});
}

/** Remove a message's buttons and keep its text */
export async function clearTelegramButtons(token: string, chatId: string, messageId: number) {
	await telegramCall(token, 'editMessageReplyMarkup', {
		chat_id: chatId,
		message_id: messageId,
		reply_markup: { inline_keyboard: [] }
	});
}

/** Bots may download files up to 20 MB */
export const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024;

/** Download a file a user sent (voice note) by its file_id */
export async function downloadTelegramFile(token: string, fileId: string) {
	const file = await telegramCall<{ file_path?: string; file_size?: number }>(token, 'getFile', {
		file_id: fileId
	});
	if (!file.file_path) throw new Error('Telegram getFile returned no file_path');
	const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
	if (!res.ok) throw new Error(`Telegram file ${res.status}`);
	const name = file.file_path.split('/').pop() || 'voice.ogg';
	return { data: await res.blob(), name };
}
