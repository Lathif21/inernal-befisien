// Email through the Resend REST API (no SDK). Relative imports only: shared with Trigger.dev.

export type EmailConfig = { apiKey: string; from: string };

export type OutgoingAttachment = {
	filename: string;
	/** Base64 */
	content: string;
	contentType?: string;
	/** Set for a picture inside the HTML (`<img src="cid:…">`) */
	contentId?: string;
};

export type OutgoingMail = {
	to: string | string[];
	subject: string;
	html: string;
	text: string;
	cc?: string[];
	replyTo?: string;
	/** Extra headers, e.g. In-Reply-To / References for a threaded reply */
	headers?: Record<string, string>;
	/** Same key within 24 h = Resend sends once and returns the same id (double submit) */
	idempotencyKey?: string;
	/** Files and inline pictures; 40 MB per email after base64 (Resend) */
	attachments?: OutgoingAttachment[];
};

export async function sendEmail(config: EmailConfig, mail: OutgoingMail) {
	if (!config.apiKey) throw new Error('RESEND_API_KEY is not set');
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.apiKey}`,
			'content-type': 'application/json',
			...(mail.idempotencyKey ? { 'idempotency-key': mail.idempotencyKey } : {})
		},
		body: JSON.stringify({
			from: config.from,
			to: Array.isArray(mail.to) ? mail.to : [mail.to],
			subject: mail.subject,
			html: mail.html,
			text: mail.text,
			...(mail.cc?.length ? { cc: mail.cc } : {}),
			...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
			...(mail.headers && Object.keys(mail.headers).length ? { headers: mail.headers } : {}),
			...(mail.attachments?.length
				? {
						attachments: mail.attachments.map((a) => ({
							filename: a.filename,
							content: a.content,
							...(a.contentType ? { content_type: a.contentType } : {}),
							...(a.contentId ? { content_id: a.contentId } : {})
						}))
					}
				: {})
		})
	});
	if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
	return ((await res.json()) as { id: string }).id;
}
