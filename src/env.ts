import { defineEnvVars } from '@sveltejs/kit/env';

// Optional at build time so `vite build` (Docker) works without secrets; enforced where they are used.
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Neon pooled connection string (…-pooler…), used by the app',
		schema: optional
	},
	BETTER_AUTH_URL: {
		description:
			'Public base URL of the app, e.g. `http://localhost:5173` or `https://crm.befisien.com`',
		schema: optional
	},
	BETTER_AUTH_SECRET: {
		description: 'Signs session tokens. At least 32 random characters in production.',
		schema: optional
	},
	TELEGRAM_BOT_TOKEN: {
		description: 'Bot token from @BotFather (daily digest and "Hubungkan Telegram")',
		schema: optional
	},
	TELEGRAM_BOT_USERNAME: {
		description: 'Bot username without @, for t.me/<bot>?start=<code> links',
		schema: optional
	},
	TELEGRAM_WEBHOOK_SECRET: {
		description: 'Telegram sends it in X-Telegram-Bot-Api-Secret-Token; /api/telegram checks it',
		schema: optional
	},
	RESEND_API_KEY: {
		description:
			'Resend key for app email; full access, because the Email page reads received email (P3-08)',
		schema: optional
	},
	SUMOPOD_API_KEY: {
		description:
			'Sumopod key for AI suggestions (OpenAI-compatible gateway, https://ai.sumopod.com)',
		schema: optional
	},
	AI_MODEL: {
		description: 'Model for AI suggestions; default claude-opus-5-5',
		schema: optional
	},
	AI_BASE_URL: {
		description: 'OpenAI-compatible base URL; default https://ai.sumopod.com/v1',
		schema: optional
	},
	NINEROUTER_API_KEY: {
		description:
			'9router key for analysis on request (Telegram strategy chat, "Minta saran AI"); unset = Sumopod',
		schema: optional
	},
	NINEROUTER_MODEL: {
		description: '9router model for analysis; default cc/claude-opus-5-5',
		schema: optional
	},
	NINEROUTER_BASE_URL: {
		description: '9router OpenAI-compatible base URL; default http://localhost:20128/v1',
		schema: optional
	},
	TRIGGER_SECRET_KEY: {
		description:
			'Trigger.dev secret key (tr_dev_… locally, tr_prod_… on the server); the Telegram webhook queues telegram-inbound with it',
		schema: optional
	},
	RESEND_WEBHOOK_SECRET: {
		description:
			'Signing secret (whsec_…) of the Resend webhook for email.received; /api/email checks it',
		schema: optional
	},
	INBOX_FROM: {
		description:
			'Sender of emails written in the CRM (Email page); default "Befisien <info@befisien.com>"',
		schema: optional
	},
	MAIL_FROM: {
		description: 'Sender of app email, e.g. "Befisien CRM <info@befisien.com>"',
		schema: optional
	},
	// Neon Object Storage, bucket email-files (P3-08 big files). The values are the branch's
	// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3 / AWS_REGION from
	// `neon env pull`, under other names because Vercel reserves the AWS_* ones.
	NEON_STORAGE_ACCESS_KEY_ID: {
		description: 'Neon storage access key id (AWS_ACCESS_KEY_ID of the branch)',
		schema: optional
	},
	NEON_STORAGE_SECRET_ACCESS_KEY: {
		description: 'Neon storage secret access key (AWS_SECRET_ACCESS_KEY of the branch)',
		schema: optional
	},
	NEON_STORAGE_ENDPOINT: {
		description: 'Neon storage S3 endpoint of the branch (AWS_ENDPOINT_URL_S3)',
		schema: optional
	},
	NEON_STORAGE_REGION: {
		description: 'Neon storage region, e.g. us-east-2 (AWS_REGION)',
		schema: optional
	}
});
