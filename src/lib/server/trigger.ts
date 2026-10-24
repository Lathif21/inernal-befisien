// Queue Trigger.dev tasks from the app (P2-10). TRIGGER_SECRET_KEY picks the environment
// (tr_dev_… runs on `npx trigger.dev dev`, tr_prod_… on the deployed tasks).
import { configure, tasks } from '@trigger.dev/sdk';
import { TRIGGER_SECRET_KEY } from '$app/env/private';
import type { InboundPayload } from '#lib/server/services/telegram-input.ts';
import type { telegramInbound } from '../../trigger/telegram-inbound.ts';

let configured = false;

export const triggerEnabled = () => !!TRIGGER_SECRET_KEY;

/** One run per Telegram update; Telegram's retries of the same update reuse the run */
export async function queueTelegramInbound(payload: InboundPayload, updateId: number) {
	if (!TRIGGER_SECRET_KEY) throw new Error('TRIGGER_SECRET_KEY is not set');
	if (!configured) {
		configure({ accessToken: TRIGGER_SECRET_KEY });
		configured = true;
	}
	return tasks.trigger<typeof telegramInbound>('telegram-inbound', payload, {
		idempotencyKey: `telegram-update-${updateId}`,
		idempotencyKeyTTL: '1d'
	});
}
