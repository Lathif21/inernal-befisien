// AI jobs (docs/04-ARCHITECTURE.md "Trigger.dev tasks", task P2-03). Runs on Trigger.dev, so it reads
// process.env and uses relative imports only.
import { logger, schedules } from '@trigger.dev/sdk';
import { dueSlot, suggestionTtlDays } from '../lib/ai-schedule';
import { DEFAULT_AI_MODEL, sumopodClient } from '../lib/server/ai/client';
import { createDb } from '../lib/server/db/client';
import {
	activeClientIds,
	expireSuggestions,
	generateSuggestions
} from '../lib/server/services/ai-suggestions';
import { getAiSettings, markAiRun } from '../lib/server/services/ai-settings';
import { refreshClientContext } from '../lib/server/services/client-context';

const env = (name: string) => process.env[name] ?? '';

function database() {
	if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set for this environment');
	return createDb(env('DATABASE_URL'));
}

/**
 * Checks every 30 minutes and runs when Pengaturan → Saran AI says so (daily / weekly / monthly at
 * a time; never for "Hanya manual"). For each active client, first the Ringkasan konteks (only when
 * its history changed), then the suggestions, which read it; with Saran AI off only the summaries.
 * Clients whose facts did not change since the last run are skipped without an AI call. One
 * failing client is logged and does not stop the others; there is no task-level retry, so a
 * retry never pays twice for clients that already succeeded.
 */
export const aiSuggestions = schedules.task({
	id: 'ai-suggestions',
	// The time is a setting, so the task wakes every 30 minutes and asks `dueSlot`
	cron: { pattern: '*/30 * * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 900,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const db = database();
		const settings = await getAiSettings(db).catch(async (e) => {
			await db.$client.end();
			throw e;
		});
		const slot = dueSlot(settings, payload.timestamp);
		if (!slot) {
			await db.$client.end();
			return { due: false };
		}
		const model = env('AI_MODEL') || DEFAULT_AI_MODEL;
		const complete = sumopodClient({
			apiKey: env('SUMOPOD_API_KEY'),
			model,
			baseUrl: env('AI_BASE_URL') || undefined
		});
		const summary = {
			clients: 0,
			created: 0,
			skipped: 0,
			failed: 0,
			suggestions: 0,
			contextsUpdated: 0,
			tokensIn: 0,
			tokensOut: 0
		};
		try {
			// Claimed first, so an overlapping check does not run the same slot again
			await markAiRun(db, payload.timestamp);
			const ids = await activeClientIds(db);
			summary.clients = ids.length;
			logger.info('active clients', {
				count: ids.length,
				model,
				slot,
				suggestions: settings.enabled ? 'on' : 'off (summaries only)'
			});
			for (const id of ids) {
				try {
					const c = await refreshClientContext(db, id, { complete });
					if (c.status === 'updated') {
						summary.contextsUpdated++;
						summary.tokensIn += c.usage?.input ?? 0;
						summary.tokensOut += c.usage?.output ?? 0;
						logger.info('context updated', { clientId: id, usage: c.usage });
					}
				} catch (e) {
					// A stale summary still beats no suggestions
					logger.error('context failed', { clientId: id, error: String(e).slice(0, 500) });
				}
				if (!settings.enabled) continue;
				try {
					const r = await generateSuggestions(db, id, { complete, now: payload.timestamp });
					if (r.status === 'skipped') {
						summary.skipped++;
						logger.info('skipped: nothing changed', { clientId: id });
						continue;
					}
					summary.created++;
					summary.suggestions += r.count;
					summary.tokensIn += r.usage?.input ?? 0;
					summary.tokensOut += r.usage?.output ?? 0;
					logger.info('suggestions created', { clientId: id, count: r.count, usage: r.usage });
				} catch (e) {
					summary.failed++;
					logger.error('client failed', { clientId: id, error: String(e).slice(0, 500) });
				}
			}
			logger.info('done', summary);
			return summary;
		} finally {
			await db.$client.end();
		}
	}
});

/** Every night at 00:30 WIB: suggestions nobody touched for 7 days expire */
export const aiExpireSuggestions = schedules.task({
	id: 'ai-expire-suggestions',
	cron: { pattern: '30 0 * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 60,
	run: async (payload) => {
		const db = database();
		try {
			const { frequency } = await getAiSettings(db);
			const expired = await expireSuggestions(db, payload.timestamp, suggestionTtlDays(frequency));
			logger.info('expired', { expired });
			return { expired };
		} finally {
			await db.$client.end();
		}
	}
});
