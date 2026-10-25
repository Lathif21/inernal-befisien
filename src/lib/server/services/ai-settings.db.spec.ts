// Saran AI settings: defaults without a row, save, and the run marker keeping the rest.
// Rolled-back transaction on the Neon `dev` branch or localhost only.
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { appSettings, user } from '../db/schema/index';
import { aiSettingsSchema } from '../../schemas/settings';
import { getAiSettings, markAiRun, saveAiSettings } from './ai-settings';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const url = process.env.DATABASE_URL;
const isDevDb =
	!!url &&
	(process.env.NEON_BRANCH === 'dev' || ['localhost', '127.0.0.1'].includes(new URL(url).hostname));

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx, userId: string) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			await fn(tx, u.id);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

describe.skipIf(!isDevDb)('ai settings (dev database)', { timeout: 30_000 }, () => {
	it('defaults, saves, and marks a run without touching the schedule', () =>
		inRollback(async (tx, userId) => {
			await tx.delete(appSettings);
			expect(await getAiSettings(tx)).toEqual({
				enabled: true,
				frequency: 'daily',
				time: '06:30',
				weekday: 1,
				monthDay: 1,
				lastRunAt: null
			});

			// a run marker before any save keeps the defaults
			const at = new Date('2026-10-26T00:31:00Z');
			await markAiRun(tx, at);
			expect(await getAiSettings(tx)).toMatchObject({ frequency: 'daily', lastRunAt: at });

			const form = aiSettingsSchema.parse({
				frequency: 'weekly',
				time: '08:00',
				weekday: '5',
				monthDay: '1'
			});
			expect(form.enabled).toBe(false); // unchecked box
			await saveAiSettings(tx, form, userId);
			expect(await getAiSettings(tx)).toEqual({
				enabled: false,
				frequency: 'weekly',
				time: '08:00',
				weekday: 5,
				monthDay: 1,
				lastRunAt: at
			});
			expect(aiSettingsSchema.safeParse({ ...form, time: '08:15' }).success).toBe(false);
		}));
});
