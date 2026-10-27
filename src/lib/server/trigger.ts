// Queue Trigger.dev tasks from the app (P2-10). TRIGGER_SECRET_KEY picks the environment
// (tr_dev_… runs on `npx trigger.dev dev`, tr_prod_… on the deployed tasks).
import { configure, runs, tasks } from '@trigger.dev/sdk';
import { TRIGGER_SECRET_KEY } from '$app/env/private';
import type { ScheduleDeps } from '#lib/server/services/email-drafts.ts';
import type { InboundPayload } from '#lib/server/services/telegram-input.ts';
import type { emailScheduledSend } from '../../trigger/email-scheduled.ts';
import type { telegramInbound } from '../../trigger/telegram-inbound.ts';

let configured = false;

export const triggerEnabled = () => !!TRIGGER_SECRET_KEY;

function connect() {
	if (!TRIGGER_SECRET_KEY) throw new Error('TRIGGER_SECRET_KEY is not set');
	if (!configured) {
		configure({ accessToken: TRIGGER_SECRET_KEY });
		configured = true;
	}
}

/** One run per Telegram update; Telegram's retries of the same update reuse the run */
export async function queueTelegramInbound(payload: InboundPayload, updateId: number) {
	connect();
	return tasks.trigger<typeof telegramInbound>('telegram-inbound', payload, {
		idempotencyKey: `telegram-update-${updateId}`,
		idempotencyKeyTTL: '1d'
	});
}

/** Scheduled email (P3-09): a delayed run per schedule; the run checks the draft before sending */
export const emailSchedule: ScheduleDeps = {
	queue: async (draftId, at) => {
		connect();
		const handle = await tasks.trigger<typeof emailScheduledSend>(
			'email-scheduled-send',
			{ draftId },
			{ delay: at }
		);
		return handle.id;
	},
	cancel: async (runId) => {
		connect();
		await runs.cancel(runId);
	}
};
