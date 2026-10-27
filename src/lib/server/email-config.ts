// The Email page (P3-08) wired to the app's env vars: who the CRM sends as, and how. The setup itself
// is in email-deps.ts, shared with the Trigger.dev task that sends scheduled email.
import {
	BETTER_AUTH_URL,
	INBOX_FROM,
	NEON_STORAGE_ACCESS_KEY_ID,
	NEON_STORAGE_ENDPOINT,
	NEON_STORAGE_REGION,
	NEON_STORAGE_SECRET_ACCESS_KEY,
	RESEND_API_KEY
} from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { createSendDeps, inboxAddress } from '#lib/server/email-deps.ts';
import { neonStorage, storageConfig, type FileStorage } from '#lib/server/storage/files.ts';

export const inboxFrom = inboxAddress(INBOX_FROM);

export const resendKey = RESEND_API_KEY ?? '';

const appUrl = (BETTER_AUTH_URL ?? '').replace(/\/$/, '');

/** The bucket for files uploaded in the drawer (P3-08 big files); null until NEON_STORAGE_* is set */
export const fileStorage: FileStorage | null = (() => {
	const config = storageConfig({
		NEON_STORAGE_ACCESS_KEY_ID,
		NEON_STORAGE_SECRET_ACCESS_KEY,
		NEON_STORAGE_ENDPOINT,
		NEON_STORAGE_REGION
	});
	return config ? neonStorage(config) : null;
})();

export const sendDeps = createSendDeps({
	db,
	resendKey,
	from: inboxFrom,
	appUrl: appUrl || 'http://localhost:5173',
	storage: fileStorage
});
