// Contacts of a client. Exactly one primary contact whenever a client has contacts
// (docs/02-DATA-MODEL.md; the partial unique index allows at most one).
// Relative imports only: shared with Trigger.dev tasks.
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { phoneNormalize } from '../../format';
import type { ContactInput } from '../../schemas/contact';
import type { DbOrTx } from '../db/client';
import { client, contact } from '../db/schema/index';
import { logActivity } from './activity';
import { ServiceError } from './errors';

export function listContacts(db: DbOrTx, clientId: string) {
	return db
		.select()
		.from(contact)
		.where(eq(contact.clientId, clientId))
		.orderBy(desc(contact.isPrimary), asc(contact.name));
}

export type ContactRow = Awaited<ReturnType<typeof listContacts>>[number];

async function assertEditableClient(db: DbOrTx, clientId: string) {
	const [row] = await db
		.select({ archivedAt: client.archivedAt })
		.from(client)
		.where(eq(client.id, clientId));
	if (!row) throw new ServiceError('Klien tidak ditemukan.');
	if (row.archivedAt)
		throw new ServiceError('Klien sudah diarsipkan. Pulihkan dulu untuk mengubah kontak.');
}

async function clearPrimary(db: DbOrTx, clientId: string, exceptId?: string) {
	await db
		.update(contact)
		.set({ isPrimary: false })
		.where(
			and(
				eq(contact.clientId, clientId),
				eq(contact.isPrimary, true),
				exceptId ? ne(contact.id, exceptId) : undefined
			)
		);
}

/** Create (input.id = '') or update a contact */
export async function saveContact(
	db: DbOrTx,
	clientId: string,
	input: ContactInput,
	userId: string
) {
	return db.transaction(async (tx) => {
		await assertEditableClient(tx, clientId);
		const existing = await tx
			.select({ id: contact.id, isPrimary: contact.isPrimary })
			.from(contact)
			.where(eq(contact.clientId, clientId));

		const current = input.id ? existing.find((c) => c.id === input.id) : undefined;
		if (input.id && !current) throw new ServiceError('Kontak tidak ditemukan.');
		if (current?.isPrimary && !input.isPrimary) {
			throw new ServiceError(
				'Klien harus punya satu kontak utama. Jadikan kontak lain sebagai utama terlebih dahulu.',
				'isPrimary'
			);
		}

		// The first contact of a client is always the primary one
		const isPrimary = input.isPrimary || !existing.some((c) => c.isPrimary && c.id !== input.id);
		if (isPrimary) await clearPrimary(tx, clientId, input.id || undefined);

		const values = {
			name: input.name,
			position: input.position || null,
			phone: phoneNormalize(input.phone),
			email: input.email || null,
			isPrimary
		};
		const [row] = current
			? await tx.update(contact).set(values).where(eq(contact.id, current.id)).returning()
			: await tx
					.insert(contact)
					.values({ ...values, clientId })
					.returning();

		await logActivity(tx, {
			clientId,
			type: 'system',
			body: current ? `Kontak ${row.name} diperbarui` : `Kontak ${row.name} ditambahkan`,
			userId
		});
		return row;
	});
}

export async function setPrimaryContact(
	db: DbOrTx,
	clientId: string,
	contactId: string,
	userId: string
) {
	return db.transaction(async (tx) => {
		await assertEditableClient(tx, clientId);
		await clearPrimary(tx, clientId, contactId);
		const [row] = await tx
			.update(contact)
			.set({ isPrimary: true })
			.where(and(eq(contact.id, contactId), eq(contact.clientId, clientId)))
			.returning({ name: contact.name });
		if (!row) throw new ServiceError('Kontak tidak ditemukan.');
		await logActivity(tx, {
			clientId,
			type: 'system',
			body: `${row.name} dijadikan kontak utama`,
			userId
		});
	});
}

/** Deleting the primary contact promotes the oldest remaining one */
export async function deleteContact(
	db: DbOrTx,
	clientId: string,
	contactId: string,
	userId: string
) {
	return db.transaction(async (tx) => {
		await assertEditableClient(tx, clientId);
		const [removed] = await tx
			.delete(contact)
			.where(and(eq(contact.id, contactId), eq(contact.clientId, clientId)))
			.returning({ name: contact.name, isPrimary: contact.isPrimary });
		if (!removed) throw new ServiceError('Kontak tidak ditemukan.');

		let promoted: string | null = null;
		if (removed.isPrimary) {
			const [next] = await tx
				.select({ id: contact.id, name: contact.name })
				.from(contact)
				.where(eq(contact.clientId, clientId))
				.orderBy(asc(contact.createdAt))
				.limit(1);
			if (next) {
				await tx.update(contact).set({ isPrimary: true }).where(eq(contact.id, next.id));
				promoted = next.name;
			}
		}

		await logActivity(tx, {
			clientId,
			type: 'system',
			body: promoted
				? `Kontak ${removed.name} dihapus; ${promoted} sekarang kontak utama`
				: `Kontak ${removed.name} dihapus`,
			userId
		});
		return { promoted };
	});
}
