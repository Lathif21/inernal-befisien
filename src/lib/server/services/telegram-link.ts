// "Hubungkan Telegram" (docs/04-ARCHITECTURE.md): the app makes a one-time code, the user opens
// t.me/<bot>?start=<code>, Telegram posts "/start <code>" to the webhook, and the chat ID is saved.
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { user } from '../db/schema/index';

export const LINK_CODE_MINUTES = 15;
/** Letters and digits without look-alikes (0/O, 1/I/L) */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(length = 10) {
	const bytes = randomBytes(length);
	return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** A fresh code (replaces any earlier one) and when it expires */
export async function createLinkCode(db: DbOrTx, userId: string, now = new Date()) {
	const code = newCode();
	const expiresAt = new Date(now.getTime() + LINK_CODE_MINUTES * 60_000);
	await db
		.update(user)
		.set({ telegramLinkCode: code, telegramLinkExpiresAt: expiresAt })
		.where(eq(user.id, userId));
	return { code, expiresAt };
}

/** Link the chat to the user holding this (unexpired) code; the code works once */
export async function linkTelegram(db: DbOrTx, code: string, chatId: string, now = new Date()) {
	const [row] = await db
		.update(user)
		.set({ telegramChatId: chatId, telegramLinkCode: null, telegramLinkExpiresAt: null })
		.where(
			and(eq(user.telegramLinkCode, code.trim().toUpperCase()), gt(user.telegramLinkExpiresAt, now))
		)
		.returning({ id: user.id, name: user.name });
	return row ?? null;
}

/** "/stop" in Telegram or "Putuskan" in Settings */
export async function unlinkTelegram(db: DbOrTx, by: { userId: string } | { chatId: string }) {
	const rows = await db
		.update(user)
		.set({ telegramChatId: null })
		.where('userId' in by ? eq(user.id, by.userId) : eq(user.telegramChatId, by.chatId))
		.returning({ id: user.id, name: user.name });
	return rows;
}

/** Digest switches of Settings */
export async function setDigestPrefs(
	db: DbOrTx,
	userId: string,
	prefs: { enabled: boolean; channels: ('telegram' | 'email')[] }
) {
	await db
		.update(user)
		.set({ digestEnabled: prefs.enabled, digestChannels: prefs.channels })
		.where(eq(user.id, userId));
}
