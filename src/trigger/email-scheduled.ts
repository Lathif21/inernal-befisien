// Email drafts, scheduled sending and Sampah (P3-09). Runs on Trigger.dev, so it reads process.env and
// uses relative imports only. Env: DATABASE_URL, RESEND_API_KEY (full access), INBOX_FROM, APP_URL,
// NEON_STORAGE_* (uploaded files), TELEGRAM_BOT_TOKEN (failure note to the writer).
import { logger, schedules, task } from '@trigger.dev/sdk';
import { createDb } from '../lib/server/db/client';
import { createSendDeps, inboxAddress } from '../lib/server/email-deps';
import { sendTelegram } from '../lib/server/notify/telegram';
import { purgeTrash } from '../lib/server/services/email';
import {
	markDraftFailed,
	scheduledFailedTelegram,
	sendScheduledDraft,
	type FailedDraft
} from '../lib/server/services/email-drafts';
import { neonStorage, storageConfig } from '../lib/server/storage/files';

const env = (name: string) => process.env[name] ?? '';
const appUrl = () => env('APP_URL').replace(/\/$/, '');

function database() {
	if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set for this environment');
	return createDb(env('DATABASE_URL'));
}

async function tellWriter(failed: FailedDraft | null) {
	if (!failed?.chatId || !env('TELEGRAM_BOT_TOKEN')) return;
	const url = `${appUrl()}/inbox?filter=scheduled`;
	await sendTelegram(
		env('TELEGRAM_BOT_TOKEN'),
		failed.chatId,
		scheduledFailedTelegram(failed, url)
	).catch((e) => logger.warn('telegram note failed', { error: String(e) }));
}

/** Queued by Jadwalkan with `delay` = the chosen time */
export const emailScheduledSend = task({
	id: 'email-scheduled-send',
	maxDuration: 300,
	// The Resend idempotency key comes from the draft, so a retry never sends twice
	retry: { maxAttempts: 3, minTimeoutInMs: 30_000, maxTimeoutInMs: 120_000, factor: 2 },
	run: async (payload: { draftId: string }) => {
		const db = database();
		try {
			const config = storageConfig(process.env);
			const deps = createSendDeps({
				db,
				resendKey: env('RESEND_API_KEY'),
				from: inboxAddress(env('INBOX_FROM')),
				appUrl: appUrl(),
				storage: config ? neonStorage(config) : null
			});
			const result = await sendScheduledDraft(db, payload.draftId, deps);
			if (result.status === 'failed') await tellWriter(result.failed);
			logger.info('scheduled email', { draftId: payload.draftId, status: result.status });
			return { status: result.status };
		} finally {
			await db.$client.end();
		}
	},
	// Every attempt failed (Resend down, a bug): show it as Gagal in Terjadwal and tell the writer
	onFailure: async ({ payload, error }) => {
		const db = database();
		try {
			const failed = await markDraftFailed(
				db,
				payload.draftId,
				'Email gagal dikirim. Coba Kirim sekarang atau jadwalkan ulang.'
			);
			logger.error('scheduled email failed', { draftId: payload.draftId, error: String(error) });
			await tellWriter(failed);
		} finally {
			await db.$client.end();
		}
	}
});

/** Every night at 01:30 WIB: conversations in Sampah for more than TRASH_DAYS are deleted for good */
export const emailTrashPurge = schedules.task({
	id: 'email-trash-purge',
	cron: { pattern: '30 1 * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 120,
	run: async (payload) => {
		const db = database();
		try {
			const result = await purgeTrash(db, { now: payload.timestamp });
			logger.info('trash purged', result);
			return result;
		} finally {
			await db.$client.end();
		}
	}
});
