// The app's digest senders, wired to its env vars. The Trigger.dev task builds its own from
// process.env (src/trigger/daily-digest.ts).
import { BETTER_AUTH_URL, MAIL_FROM, RESEND_API_KEY, TELEGRAM_BOT_TOKEN } from '$app/env/private';
import { sendEmail } from '#lib/server/notify/email.ts';
import { sendTelegram } from '#lib/server/notify/telegram.ts';
import type { DigestSenders } from '#lib/server/services/digest.ts';

export const appUrl = BETTER_AUTH_URL ?? 'http://localhost:5173';

export const senders: DigestSenders = {
	telegram: (chatId, html) => sendTelegram(TELEGRAM_BOT_TOKEN ?? '', chatId, html),
	email: (mail) =>
		sendEmail(
			{ apiKey: RESEND_API_KEY ?? '', from: MAIL_FROM ?? 'Befisien CRM <info@befisien.com>' },
			mail
		)
};
