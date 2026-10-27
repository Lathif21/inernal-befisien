// The Email page (P3-08) wired to the app's env vars: who the CRM sends as, and how.
import { BETTER_AUTH_URL, INBOX_FROM, RESEND_API_KEY } from '$app/env/private';
import { formatAddress, parseAddress, type EmailBrand } from '#lib/email.ts';
import { sendEmail } from '#lib/server/notify/email.ts';
import type { SendDeps } from '#lib/server/services/email.ts';

const DEFAULT_FROM = 'Befisien <info@befisien.com>';

export const inboxFrom = parseAddress(INBOX_FROM ?? DEFAULT_FROM) ?? parseAddress(DEFAULT_FROM)!;

export const resendKey = RESEND_API_KEY ?? '';

const appUrl = (BETTER_AUTH_URL ?? '').replace(/\/$/, '');

/**
 * The signature's company look, as on befisien.com. The logo is served by the app itself
 * (static/email), so it needs the public app URL; locally there is none and the logo is left out.
 */
export const emailBrand: EmailBrand = {
	logoUrl: appUrl.startsWith('https://') ? `${appUrl}/email/befisien-mark.png` : null,
	name: 'Befisien',
	wordmark: 'BEFISIEN',
	tagline: 'Tingkatkan Efisiensi dan Akselerasi Bisnis Anda',
	services: ['AI Agent', 'Otomasi Workflow', 'Integrasi Sistem', 'Dashboard & Aplikasi'],
	links: [
		{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/befisien-ai-b99a183b2' },
		{ label: 'Instagram', url: 'https://www.instagram.com/befisien_id' }
	]
};

export const sendDeps: SendDeps = {
	from: inboxFrom,
	brand: emailBrand,
	send: (mail) => sendEmail({ apiKey: resendKey, from: formatAddress(inboxFrom) }, mail)
};
