// Database tests for contacts and the activity timeline. Neon `dev` branch (or localhost) only,
// inside a transaction that is always rolled back.
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { user } from '../db/schema/index';
import { noteSchema } from '../../schemas/activity';
import { clientSchema } from '../../schemas/client';
import { contactSchema } from '../../schemas/contact';
import { addNote, listActivities } from './activity';
import { archiveClient, createClient } from './clients';
import { deleteContact, listContacts, saveContact, setPrimaryContact } from './contacts';
import { ServiceError } from './errors';

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

async function inRollback(fn: (tx: Tx, userId: string) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			await fn(tx, u.id);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

const contact = (fields: Record<string, unknown>) => contactSchema.parse(fields);
const primaries = async (tx: Tx, clientId: string) =>
	(await listContacts(tx, clientId)).filter((c) => c.isPrimary).map((c) => c.name);

describe.skipIf(!isDevDb)('contacts service (dev database)', { timeout: 30_000 }, () => {
	it('keeps exactly one primary contact through add, switch and delete', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(
				tx,
				clientSchema.parse({ name: 'ZZ Test Kontak Utama' }),
				userId
			);

			const ani = await saveContact(
				tx,
				c.id,
				contact({ name: 'Ani', phone: '0812-1111-2222' }),
				userId
			);
			expect(ani.isPrimary).toBe(true); // first contact becomes primary
			expect(ani.phone).toBe('6281211112222');

			await saveContact(tx, c.id, contact({ name: 'Budi' }), userId);
			expect(await primaries(tx, c.id)).toEqual(['Ani']);

			const cici = await saveContact(tx, c.id, contact({ name: 'Cici', isPrimary: true }), userId);
			expect(await primaries(tx, c.id)).toEqual(['Cici']);

			// the primary cannot be switched off directly
			await expect(
				saveContact(tx, c.id, contact({ id: cici.id, name: 'Cici', isPrimary: false }), userId)
			).rejects.toThrow(ServiceError);

			await setPrimaryContact(tx, c.id, ani.id, userId);
			expect(await primaries(tx, c.id)).toEqual(['Ani']);

			// deleting the primary promotes a remaining contact (the oldest; inside one transaction
			// now() is the same for every row, so either remaining contact may be picked here)
			const { promoted } = await deleteContact(tx, c.id, ani.id, userId);
			expect(['Budi', 'Cici']).toContain(promoted);
			expect(await primaries(tx, c.id)).toEqual([promoted]);
		});
	});

	it('refuses contact changes on an archived client', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Test Arsip' }), userId);
			await archiveClient(tx, c.id, userId);
			await expect(saveContact(tx, c.id, contact({ name: 'Dodi' }), userId)).rejects.toThrow(
				ServiceError
			);
		});
	});

	it('lists the timeline newest first, including back-dated notes', async () => {
		await inRollback(async (tx, userId) => {
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Test Timeline' }), userId);
			await addNote(
				tx,
				c.id,
				noteSchema.parse({ type: 'call', body: 'Telepon kemarin', occurredAt: '2026-01-05T09:00' }),
				userId
			);
			await addNote(tx, c.id, noteSchema.parse({ type: 'note', body: 'Catatan barusan' }), userId);

			const { rows, total } = await listActivities(tx, c.id);
			expect(total).toBe(3); // "Klien ditambahkan" + 2 notes
			expect(rows.map((r) => r.body)).toEqual([
				'Catatan barusan',
				'Klien ditambahkan',
				'Telepon kemarin'
			]);
			expect(rows[2].occurredAt.toISOString()).toBe('2026-01-05T02:00:00.000Z'); // 09:00 WIB
		});
	});
});
