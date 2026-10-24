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
		description: 'Resend key for the digest email (send-only is enough)',
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
	TRIGGER_SECRET_KEY: {
		description:
			'Trigger.dev secret key (tr_dev_… locally, tr_prod_… on the server); the Telegram webhook queues telegram-inbound with it',
		schema: optional
	},
	MAIL_FROM: {
		description: 'Sender of app email, e.g. "Befisien CRM <info@befisien.com>"',
		schema: optional
	}
});
