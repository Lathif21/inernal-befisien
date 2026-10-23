// Settings: users and categories. Neon `dev` branch (or localhost) only, inside a transaction that
// is always rolled back.
import { verifyPassword } from 'better-auth/crypto';
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { account, category, session, transaction } from '../db/schema/index';
import { categorySchema } from '../../schemas/settings';
import { clientSchema } from '../../schemas/client';
import { deleteCategory, listCategoriesWithUsage, moveCategory, saveCategory } from './categories';
import { createClient } from './clients';
import { ServiceError } from './errors';
import { createUser, listUsers, resetPassword } from './users';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const url = process.env.DATABASE_URL;
const isDevDb =
	!!url &&
	(process.env.NEON_BRANCH === 'dev' || ['localhost', '127.0.0.1'].includes(new URL(url).hostname));

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			await fn(tx);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

const hashOf = async (tx: Tx, userId: string) =>
	(
		await tx
			.select({ password: account.password })
			.from(account)
			.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
	)[0].password!;

const fieldOf = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(e) => (e instanceof ServiceError ? (e.field ?? e.message) : String(e))
	);

describe.skipIf(!isDevDb)('settings services (dev database)', { timeout: 120_000 }, () => {
	it('adds a user who can log in, refuses a duplicate email, and resets the password', async () => {
		await inRollback(async (tx) => {
			const made = await createUser(tx, {
				name: 'Rina Kartika',
				email: '  ZZ.Rina@Befisien.TEST ',
				role: 'admin',
				password: 'RahasiaRina1'
			});
			expect([made.email, made.generated]).toEqual(['zz.rina@befisien.test', false]);
			expect(
				await verifyPassword({ hash: await hashOf(tx, made.id), password: 'RahasiaRina1' })
			).toBe(true);
			expect((await listUsers(tx)).find((u) => u.id === made.id)).toMatchObject({
				name: 'Rina Kartika',
				role: 'admin',
				digestEnabled: true,
				telegramLinked: false
			});

			expect(
				await fieldOf(
					createUser(tx, { name: 'Lagi', email: 'zz.rina@befisien.test', role: 'admin' })
				)
			).toBe('email');

			// generated password, and the user's sessions end on reset
			await tx.insert(session).values({
				id: 'zz-session',
				token: 'zz-token',
				userId: made.id,
				expiresAt: new Date(Date.now() + 86_400_000),
				updatedAt: new Date()
			});
			const reset = await resetPassword(tx, made.id);
			expect(reset.generated).toBe(true);
			expect(reset.password).toHaveLength(16);
			const hash = await hashOf(tx, made.id);
			expect(await verifyPassword({ hash, password: reset.password })).toBe(true);
			expect(await verifyPassword({ hash, password: 'RahasiaRina1' })).toBe(false);
			expect(await tx.select().from(session).where(eq(session.userId, made.id))).toEqual([]);
		});
	});

	it('keeps categories unique per type, ordered, and only deletes unused ones', async () => {
		await inRollback(async (tx) => {
			const save = (fields: Record<string, string>) =>
				saveCategory(tx, categorySchema.parse(fields));
			const a = await save({ type: 'expense', name: 'ZZ Iklan' });
			const b = await save({ type: 'expense', name: 'ZZ Domain' });
			const names = async () =>
				(
					await tx
						.select({ name: category.name })
						.from(category)
						.where(eq(category.type, 'expense'))
						.orderBy(asc(category.sort), asc(category.name))
				)
					.map((c) => c.name)
					.filter((n) => n.startsWith('ZZ'));
			expect(await names()).toEqual(['ZZ Iklan', 'ZZ Domain']);

			expect(await fieldOf(save({ type: 'expense', name: 'zz iklan' }))).toBe('name');
			// the same name is fine for the other type
			await save({ type: 'income', name: 'ZZ Iklan' });

			await save({ id: a.id, type: 'income', name: 'ZZ Iklan Digital' }); // type ignored on rename
			await moveCategory(tx, b.id, 'up');
			expect(await names()).toEqual(['ZZ Domain', 'ZZ Iklan Digital']);
			await moveCategory(tx, b.id, 'up'); // passes a seeded category; the two ZZ ones keep their order
			expect(await names()).toEqual(['ZZ Domain', 'ZZ Iklan Digital']);

			const c = await createClient(
				tx,
				clientSchema.parse({ name: 'ZZ Klien Kategori' }),
				(await listUsers(tx))[0].id
			);
			await tx.insert(transaction).values({
				type: 'expense',
				amount: 1000,
				date: '2030-01-01',
				clientId: c.id,
				categoryId: b.id
			});
			expect(await fieldOf(deleteCategory(tx, b.id))).toMatch(/dipakai di 1 transaksi/);
			await deleteCategory(tx, a.id);
			expect(await names()).toEqual(['ZZ Domain']);
			const usage = (await listCategoriesWithUsage(tx)).find((x) => x.id === b.id);
			expect(usage?.used).toBe(1);
		});
	});
});
