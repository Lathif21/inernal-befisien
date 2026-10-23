// AI jobs (docs/04-ARCHITECTURE.md "Trigger.dev tasks", task P2-03). Runs on Trigger.dev, so it reads
// process.env and uses relative imports only.
import { logger, schedules } from '@trigger.dev/sdk';
import { DEFAULT_AI_MODEL, sumopodClient } from '../lib/server/ai/client';
import { createDb } from '../lib/server/db/client';
import {
	activeClientIds,
	expireSuggestions,
	generateSuggestions
} from '../lib/server/services/ai-suggestions';

const env = (name: string) => process.env[name] ?? '';

function database() {
	if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set for this environment');
	return createDb(env('DATABASE_URL'));
}

/**
 * Every morning at 06:30 WIB (before the 07:30 digest): suggestions for each active client.
 * Clients whose facts did not change since the last run are skipped without an AI call. One
 * failing client is logged and does not stop the others; there is no task-level retry, so a
 * retry never pays twice for clients that already succeeded.
 */
export const aiSuggestions = schedules.task({
	id: 'ai-suggestions',
	// window: start within 5 minutes, so it always finishes before the 07:30 digest
	cron: { pattern: '30 6 * * *', timezone: 'Asia/Jakarta', window: '5m' },
	maxDuration: 900,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const db = database();
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
			tokensIn: 0,
			tokensOut: 0
		};
		try {
			const ids = await activeClientIds(db);
			summary.clients = ids.length;
			logger.info('active clients', { count: ids.length, model });
			for (const id of ids) {
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
			const expired = await expireSuggestions(db, payload.timestamp);
			logger.info('expired', { expired });
			return { expired };
		} finally {
			await db.$client.end();
		}
	}
});
