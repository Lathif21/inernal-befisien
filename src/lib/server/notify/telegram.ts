// Telegram Bot API over plain HTTPS (docs/04-ARCHITECTURE.md). Relative imports only: shared with
// Trigger.dev. The token is passed in, so the app ($app/env/private) and the task (process.env)
// each supply their own.

/** Text for Telegram's HTML parse mode: only &, < and > need escaping */
export function escapeHtml(text: string) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegram(token: string, chatId: string, html: string) {
	if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
	const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: html,
			parse_mode: 'HTML',
			link_preview_options: { is_disabled: true }
		})
	});
	if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}
