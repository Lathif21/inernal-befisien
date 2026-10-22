import { BETTER_AUTH_URL, BETTER_AUTH_SECRET } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { db } from '#lib/server/db/index.ts';

export const auth = betterAuth({
	baseURL: BETTER_AUTH_URL,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	// No public sign-up: users come from scripts/create-user.ts or Settings → Pengguna
	emailAndPassword: { enabled: true, disableSignUp: true },
	user: {
		additionalFields: {
			role: { type: 'string', defaultValue: 'admin', input: false },
			phone: { type: 'string', required: false },
			digestEnabled: { type: 'boolean', defaultValue: true, input: false }
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // must stay the last plugin
	]
});

export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;
