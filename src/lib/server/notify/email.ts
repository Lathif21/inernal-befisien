// Email through the Resend REST API (no SDK). Relative imports only: shared with Trigger.dev.

export type EmailConfig = { apiKey: string; from: string };

export async function sendEmail(
	config: EmailConfig,
	mail: { to: string; subject: string; html: string; text: string }
) {
	if (!config.apiKey) throw new Error('RESEND_API_KEY is not set');
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.apiKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from: config.from,
			to: [mail.to],
			subject: mail.subject,
			html: mail.html,
			text: mail.text
		})
	});
	if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
	return ((await res.json()) as { id: string }).id;
}
