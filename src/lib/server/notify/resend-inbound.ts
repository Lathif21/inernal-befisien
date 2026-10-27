// Resend Inbound (P3-08) over the REST API (no SDK): webhook signatures and received emails.
// Relative imports only: shared with Trigger.dev. Docs: resend.com/docs/dashboard/receiving.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.resend.com';

/** Resend signs webhooks the Svix way; a signature older than this is refused (replays) */
const TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = { id: string; timestamp: string; signature: string };

/**
 * Check a webhook against its signing secret (`whsec_…` from the webhook page): HMAC-SHA256 over
 * `id.timestamp.body` with the base64 key, compared with each `v1,<base64>` in the header.
 */
export function verifyWebhook(
	secret: string,
	headers: WebhookHeaders,
	body: string,
	now = Date.now()
) {
	if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
	const ts = Number(headers.timestamp);
	if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;
	const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
	const expected = createHmac('sha256', key)
		.update(`${headers.id}.${headers.timestamp}.${body}`)
		.digest();
	return headers.signature.split(' ').some((part) => {
		const [version, sig] = part.split(',', 2);
		if (version !== 'v1' || !sig) return false;
		const given = Buffer.from(sig, 'base64');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

/** The `email.received` webhook body; only metadata, the content is fetched with the id */
export type ReceivedEvent = {
	type: string;
	created_at: string;
	data: { email_id: string; message_id?: string; subject?: string; from?: string };
};

export type ReceivedAttachment = {
	id: string;
	filename: string;
	content_type: string;
	content_disposition: string | null;
	content_id: string | null;
	size: number;
};

export type ReceivedEmail = {
	id: string;
	created_at: string;
	from: string;
	to: string[];
	cc: string[] | null;
	reply_to: string[] | null;
	subject: string | null;
	html: string | null;
	text: string | null;
	headers: Record<string, string | string[]> | null;
	message_id: string | null;
	attachments: ReceivedAttachment[] | null;
};

async function call<T>(apiKey: string, path: string): Promise<T> {
	if (!apiKey) throw new Error('RESEND_API_KEY is not set');
	const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${apiKey}` } });
	if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
	return (await res.json()) as T;
}

/** Inline images as data: URIs make large bodies; above this the cid: version is kept instead */
const MAX_HTML = 1_500_000;

/** The full received email. Needs a full-access API key (a send-only key is refused). */
export async function getReceivedEmail(apiKey: string, emailId: string) {
	const id = encodeURIComponent(emailId);
	const email = await call<ReceivedEmail>(apiKey, `/emails/receiving/${id}?html_format=data_uri`);
	if (email.html && email.html.length > MAX_HTML)
		return call<ReceivedEmail>(apiKey, `/emails/receiving/${id}?html_format=cid`);
	return email;
}

/** A fresh download link for one attachment (valid for an hour) */
export async function getReceivedAttachment(apiKey: string, emailId: string, attachmentId: string) {
	return call<ReceivedAttachment & { download_url: string; expires_at: string }>(
		apiKey,
		`/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`
	);
}
