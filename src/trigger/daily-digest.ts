// Daily digest at 07:30 WIB (docs/04-ARCHITECTURE.md). Runs on Trigger.dev, so it reads
// process.env and uses relative imports (no SvelteKit aliases or $app modules here).
import { logger, schedules } from '@trigger.dev/sdk';
import { createDb } from '../lib/server/db/client';
import { sendEmail } from '../lib/server/notify/email';
import { sendTelegram } from '../lib/server/notify/telegram';
import { runDailyDigest } from '../lib/server/services/digest';

const env = (name: string) => process.env[name] ?? '';

export const dailyDigest = schedules.task({
	id: 'daily-digest',
	cron: { pattern: '30 7 * * *', timezone: 'Asia/Jakarta' },
	maxDuration: 120,
	run: async (payload) => {
		if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set for this environment');
		const db = createDb(env('DATABASE_URL'));
		try {
			const results = await runDailyDigest(db, {
				now: payload.timestamp,
				appUrl: env('APP_URL') || 'https://befisien-crm.vercel.app',
				senders: {
					telegram: (chatId, html) => sendTelegram(env('TELEGRAM_BOT_TOKEN'), chatId, html),
					email: (mail) =>
						sendEmail(
							{
								apiKey: env('RESEND_API_KEY'),
								from: env('MAIL_FROM') || 'Befisien CRM <info@befisien.com>'
							},
							mail
						)
				}
			});
			// A failed channel is logged, not retried: a retry would resend the channels that worked
			for (const r of results) {
				const line = { user: r.email, items: r.total, telegram: r.telegram, email: r.mail };
				if (r.errors.length) logger.error('digest channel failed', { ...line, errors: r.errors });
				else logger.info(r.total ? 'digest sent' : 'nothing due, not sent', line);
			}
			return results.map(({ email, total, telegram, mail }) => ({ email, total, telegram, mail }));
		} finally {
			await db.$client.end();
		}
	}
});
