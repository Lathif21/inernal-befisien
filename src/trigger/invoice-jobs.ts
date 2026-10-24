// Invoice jobs (docs/04-ARCHITECTURE.md "Trigger.dev tasks", task P2-09). Runs on Trigger.dev, so it
// reads process.env and uses relative imports only.
import { logger, schedules } from '@trigger.dev/sdk';
import { createDb } from '../lib/server/db/client';
import { sendEmail } from '../lib/server/notify/email';
import { sendTelegram } from '../lib/server/notify/telegram';
import { markOverdueInvoices, runInvoiceReminder } from '../lib/server/services/invoice-jobs';

const env = (name: string) => process.env[name] ?? '';

function database() {
	if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set for this environment');
	return createDb(env('DATABASE_URL'));
}

/** Every night at 00:15 WIB: "Terkirim" invoices past their due date become "Jatuh tempo" */
export const invoiceMarkOverdue = schedules.task({
	id: 'invoice-mark-overdue',
	cron: { pattern: '15 0 * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 60,
	run: async (payload) => {
		const db = database();
		try {
			const rows = await markOverdueInvoices(db, payload.timestamp);
			logger.info('marked overdue', { count: rows.length, invoices: rows.map((r) => r.number) });
			return { marked: rows.map((r) => r.number) };
		} finally {
			await db.$client.end();
		}
	}
});

/** Every morning at 08:00 WIB: the team hears about invoices due in 3 days (never the client) */
export const invoiceDueReminder = schedules.task({
	id: 'invoice-due-reminder',
	cron: { pattern: '0 8 * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 120,
	// No task-level retry: it would message the team twice
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const db = database();
		try {
			const r = await runInvoiceReminder(db, {
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
			for (const u of r.results) {
				const line = { user: u.email, telegram: u.telegram, email: u.mail };
				if (u.errors.length) logger.error('reminder channel failed', { ...line, errors: u.errors });
				else logger.info('reminder sent', line);
			}
			if (!r.invoices) logger.info('no invoice due on', { dueDate: r.dueDate });
			return {
				dueDate: r.dueDate,
				invoices: r.invoices,
				results: r.results.map(({ email, telegram, mail }) => ({ email, telegram, mail }))
			};
		} finally {
			await db.$client.end();
		}
	}
});
