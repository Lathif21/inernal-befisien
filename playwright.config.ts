// Smoke tests (task P1-14): `npm run test:e2e`. They create data, so by default they run only
// against a local dev server on the Neon `dev` branch (started for you if not running).
// E2E_BASE_URL / E2E_EMAIL / E2E_PASSWORD override the target and login; a non-local target also
// needs E2E_ALLOW_WRITES=1. PW_CHANNEL picks an installed browser (Windows default: Edge).
import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(baseURL);
if (!local && process.env.E2E_ALLOW_WRITES !== '1') {
	throw new Error(
		'The smoke tests write data. Set E2E_ALLOW_WRITES=1 to run them against ' + baseURL
	);
}

export default defineConfig({
	testDir: './tests/e2e',
	// One flow after another: later tests use what earlier ones created
	workers: 1,
	fullyParallel: false,
	// Neon dev from far away can need a few seconds per request
	timeout: 180_000,
	expect: { timeout: 30_000 },
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL,
		channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
		viewport: { width: 1400, height: 950 },
		locale: 'id-ID',
		timezoneId: 'Asia/Jakarta',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: local
		? {
				command: 'npm run dev -- --port 5173 --strictPort',
				url: `${baseURL}/login`,
				reuseExistingServer: true,
				timeout: 120_000
			}
		: undefined
});
