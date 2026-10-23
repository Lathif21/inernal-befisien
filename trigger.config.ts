// Trigger.dev v4 (docs/04-ARCHITECTURE.md "Trigger.dev tasks"). Dev: `npx trigger.dev@latest dev`.
// Deploy: `npx trigger.dev@latest deploy` (syncs the cron schedules). Task env vars (DATABASE_URL,
// TELEGRAM_BOT_TOKEN, RESEND_API_KEY, MAIL_FROM, APP_URL) are set per environment in the dashboard.
import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
	// The project ref is an identifier, not a secret
	project: 'proj_awqltsqalzrhdmrrsyzr',
	dirs: ['./src/trigger'],
	maxDuration: 300,
	retries: {
		enabledInDev: false,
		default: { maxAttempts: 2, minTimeoutInMs: 5_000, factor: 2 }
	}
});
