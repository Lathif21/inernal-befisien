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
	}
});
