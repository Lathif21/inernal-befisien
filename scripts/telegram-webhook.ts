// Registers the bot's webhook and command menu (P1-12, P2-10). Re-run when the app URL changes
// (VPS) or when the bot needs another update type. Reads TELEGRAM_BOT_TOKEN and
// TELEGRAM_WEBHOOK_SECRET from .env (or the shell).
//   npm run telegram:webhook -- --url https://befisien-crm.vercel.app
//   npm run telegram:webhook -- --info
import { parseArgs } from 'node:util';
import { telegramCall } from '../src/lib/server/notify/telegram.ts';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const { values } = parseArgs({ options: { url: { type: 'string' }, info: { type: 'boolean' } } });
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

if (values.url) {
	if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');
	const url = `${values.url.replace(/\/$/, '')}/api/telegram`;
	await telegramCall(token, 'setWebhook', {
		url,
		secret_token: secret,
		// callback_query = the Simpan / Batal buttons of the drafts
		allowed_updates: ['message', 'callback_query']
	});
	await telegramCall(token, 'setMyCommands', {
		commands: [
			{ command: 'bantuan', description: 'Contoh cara mencatat lewat chat atau voice note' },
			{ command: 'stop', description: 'Putuskan Telegram dari Befisien CRM' }
		]
	});
	console.log(`Webhook set to ${url} (message, callback_query); commands /bantuan, /stop.`);
} else if (!values.info) {
	console.log('Pass --url <app url> to register the webhook, or --info to show it.');
}

const info = await telegramCall<Record<string, unknown>>(token, 'getWebhookInfo', {});
console.log({
	url: info.url,
	allowed_updates: info.allowed_updates,
	pending_update_count: info.pending_update_count,
	last_error_message: info.last_error_message
});
