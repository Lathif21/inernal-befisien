// Users of the CRM (Settings → Pengguna, task P1-13). Relative imports only: scripts/create-user.ts
// uses this too. Public sign-up stays off; admins add people here.
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { UserRole } from '../../constants';
import type { DbOrTx } from '../db/client';
import { account, session, user } from '../db/schema/index';
import { ServiceError } from './errors';

/** A readable random password (16 characters, URL-safe) */
export function generatePassword() {
	return randomBytes(12).toString('base64url');
}

export function listUsers(db: DbOrTx) {
	return db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			digestEnabled: user.digestEnabled,
			telegramLinked: sql<boolean>`${user.telegramChatId} is not null`,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(asc(user.createdAt), asc(user.name));
}

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

/**
 * A new login (email + password, the same account rows Better Auth writes). Returns the password
 * so a generated one can be shown once.
 */
export async function createUser(
	db: DbOrTx,
	input: { name: string; email: string; role: UserRole; password?: string }
) {
	const email = input.email.trim().toLowerCase();
	const password = input.password || generatePassword();
	return db.transaction(async (tx) => {
		const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
		if (existing) throw new ServiceError('Email ini sudah dipakai pengguna lain.', 'email');
		const id = randomUUID();
		await tx
			.insert(user)
			.values({ id, email, name: input.name.trim(), role: input.role, emailVerified: true });
		await tx.insert(account).values({
			id: randomUUID(),
			userId: id,
			accountId: id,
			providerId: 'credential',
			password: await hashPassword(password)
		});
		return { id, email, password, generated: !input.password };
	});
}

/** New password for a user; their open sessions end, so the old password cannot linger */
export async function resetPassword(db: DbOrTx, userId: string, newPassword?: string) {
	const password = newPassword || generatePassword();
	return db.transaction(async (tx) => {
		const [u] = await tx
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(eq(user.id, userId));
		if (!u) throw new ServiceError('Pengguna tidak ditemukan.');
		const updated = await tx
			.update(account)
			.set({ password: await hashPassword(password) })
			.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
			.returning({ id: account.id });
		if (!updated.length) {
			await tx.insert(account).values({
				id: randomUUID(),
				userId,
				accountId: userId,
				providerId: 'credential',
				password: await hashPassword(password)
			});
		}
		await tx.delete(session).where(eq(session.userId, userId));
		return { name: u.name, password, generated: !newPassword };
	});
}

export async function setUserDigest(db: DbOrTx, userId: string, enabled: boolean) {
	const rows = await db
		.update(user)
		.set({ digestEnabled: enabled })
		.where(eq(user.id, userId))
		.returning({ id: user.id });
	if (!rows.length) throw new ServiceError('Pengguna tidak ditemukan.');
}
