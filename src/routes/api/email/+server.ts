// Resend Inbound webhook (P3-08). Public route: Resend proves itself with the Svix signature of the
// webhook's signing secret. The event has only metadata, so the full email is fetched, stored and
// announced on Telegram. Any error answers 500 and Resend retries; a repeat is stored once.
import { json } from '@sveltejs/kit';
import { BETTER_AUTH_URL, RESEND_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN } from '$app/env/private';
import { resolve } from '$app/paths';
import { db } from '#lib/server/db/index.ts';
import { resendKey } from '#lib/server/email-config.ts';
import {
	getReceivedEmail,
	verifyWebhook,
	type ReceivedEvent
} from '#lib/server/notify/resend-inbound.ts';
import { sendTelegram } from '#lib/server/notify/telegram.ts';
import {
	alertChats,
	emailAlertTelegram,
	fromReceived,
	receiveEmail
} from '#lib/server/services/email.ts';
import type { RequestHandler } from './$types';

const appUrl = (BETTER_AUTH_URL ?? 'http://localhost:5173').replace(/\/$/, '');

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.text();
	const ok = verifyWebhook(
		RESEND_WEBHOOK_SECRET ?? '',
		{
			id: request.headers.get('svix-id') ?? '',
			timestamp: request.headers.get('svix-timestamp') ?? '',
			signature: request.headers.get('svix-signature') ?? ''
		},
		body
	);
	if (!ok) return new Response('Forbidden', { status: 401 });

	const event = JSON.parse(body) as ReceivedEvent;
	// Sending events (delivered, bounced) may share the endpoint; only received mail is stored
	if (event.type !== 'email.received' || !event.data?.email_id) return json({ ok: true });

	const email = await getReceivedEmail(resendKey, event.data.email_id);
	const stored = await receiveEmail(db, fromReceived(email));
	if (!stored.created || stored.message.bulk) return json({ ok: true });

	// The email is safe in the inbox; a failed alert must not make Resend deliver it again
	const url = `${appUrl}${resolve('/(app)/inbox/[id]', { id: stored.message.threadId })}`;
	const html = emailAlertTelegram(stored.message, { clientName: stored.clientName, url });
	const chats = await alertChats(db);
	await Promise.all(
		chats.map((chatId) =>
			sendTelegram(TELEGRAM_BOT_TOKEN ?? '', chatId, html).catch((e) =>
				console.warn('[email] telegram alert failed:', String(e))
			)
		)
	);
	return json({ ok: true });
};
