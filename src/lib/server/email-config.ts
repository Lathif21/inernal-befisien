// Kotak Masuk (P3-08) wired to the app's env vars: who the CRM sends as, and how.
import { INBOX_FROM, RESEND_API_KEY } from '$app/env/private';
import { formatAddress, parseAddress } from '#lib/email.ts';
import { sendEmail } from '#lib/server/notify/email.ts';
import type { SendDeps } from '#lib/server/services/email.ts';

const DEFAULT_FROM = 'Befisien Technologies <info@befisien.com>';

export const inboxFrom = parseAddress(INBOX_FROM ?? DEFAULT_FROM) ?? parseAddress(DEFAULT_FROM)!;

export const resendKey = RESEND_API_KEY ?? '';

export const sendDeps: SendDeps = {
	from: inboxFrom,
	send: (mail) => sendEmail({ apiKey: resendKey, from: formatAddress(inboxFrom) }, mail)
};
