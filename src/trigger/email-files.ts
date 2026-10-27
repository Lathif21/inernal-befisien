// Email page big files (P3-08): delete expired files from the Neon bucket. Runs on Trigger.dev, so it
// reads process.env and uses relative imports only. Env: DATABASE_URL and NEON_STORAGE_* (the
// production branch's storage credentials, as on Vercel).
import { logger, schedules } from '@trigger.dev/sdk';
import { createDb } from '../lib/server/db/client';
import { cleanupEmailFiles } from '../lib/server/services/email-files';
import { neonStorage, storageConfig } from '../lib/server/storage/files';

/** Every night at 01:00 WIB: files past their link's last day, and uploads never sent */
export const emailFilesCleanup = schedules.task({
	id: 'email-files-cleanup',
	cron: { pattern: '0 1 * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 300,
	run: async (payload) => {
		if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set for this environment');
		const config = storageConfig(process.env);
		if (!config) {
			logger.warn('NEON_STORAGE_* is not set: nothing to clean');
			return { deleted: 0 };
		}
		const db = createDb(process.env.DATABASE_URL);
		try {
			const result = await cleanupEmailFiles(db, neonStorage(config), payload.timestamp);
			logger.info('email files cleaned', result);
			return result;
		} finally {
			await db.$client.end();
		}
	}
});
