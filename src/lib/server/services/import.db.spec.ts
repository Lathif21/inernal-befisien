// Database tests for the client CSV import. Neon `dev` branch (or localhost) only, inside a
// transaction that is always rolled back.
import { and, eq, ilike, isNull, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS } from '../../import/client-csv';
import { createDb, type Tx } from '../db/client';
import { action, client, contact, deal, project, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { createClient } from './clients';
import { ServiceError } from './errors';
import { previewImport, runImport } from './import';

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

const row = (cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>) =>
	IMPORT_COLUMNS.map((c) => cells[c] ?? '').join(',');
const csv = (...rows: string[]) => [IMPORT_COLUMNS.join(','), ...rows].join('\n');

const SAMPLE = csv(
	row({
		client_name: 'PT ZZ Impor Satu',
		industry: 'energy',
		city: 'Surabaya',
		contact_name: 'Budi',
		contact_phone: '0812-3456-7890',
		deal_title: 'Monitoring PLTS',
		service_type: 'energy_ai',
		deal_stage: 'proposal',
		deal_value: '85000000',
		next_action: 'Follow up proposal',
		next_action_due: '2030-10-24 10:00',
		notes: 'Dari pameran'
	}),
	// same client again (other case): second contact, no new client
	row({ client_name: 'pt zz impor satu', contact_name: 'Sari', contact_email: 'sari@zz.id' }),
	row({
		client_name: 'CV ZZ Impor Dua',
		deal_title: 'Website katalog',
		deal_stage: 'won',
		deal_value: '32000000'
	}),
	row({ client_name: 'ZZ Impor Tiga', deal_title: 'Chatbot', deal_stage: 'lost' }),
	// invalid: skipped
	row({ client_name: 'PT ZZ Rusak', contact_phone: '0812' }),
	// existing client in the CRM
	row({ client_name: 'ZZ Klien Lama', contact_name: 'Dewi', notes: 'Pernah order 2024' })
);

const clientsLike = (tx: Tx) =>
	tx
		.select({ id: client.id, name: client.name, notes: client.notes })
		.from(client)
		.where(ilike(client.name, '%zz impor%'));

describe.skipIf(!isDevDb)('client import (dev database)', { timeout: 120_000 }, () => {
	it('previews, imports valid rows, skips invalid ones, and re-importing adds nothing', async () => {
		await inRollback(async (tx, userId) => {
			const lama = await createClient(tx, clientSchema.parse({ name: 'ZZ Klien Lama' }), userId);

			const preview = await previewImport(tx, SAMPLE);
			expect(preview.lines.map((l) => [l.line, l.match, l.errors.length])).toEqual([
				[2, 'new', 0],
				[3, 'repeat', 0],
				[4, 'new', 0],
				[5, 'new', 0],
				[6, null, 1],
				[7, 'existing', 0]
			]);

			const first = await runImport(tx, SAMPLE, userId);
			expect(first).toEqual({
				rows: 5,
				skippedRows: 1,
				clientsCreated: 3,
				clientsMatched: 1,
				contactsAdded: 3,
				contactsSkipped: 0,
				dealsCreated: 3,
				dealsSkipped: 0,
				projectsCreated: 1
			});

			const created = await clientsLike(tx);
			expect(created.map((c) => c.name).sort()).toEqual([
				'CV ZZ Impor Dua',
				'PT ZZ Impor Satu',
				'ZZ Impor Tiga'
			]);
			const satu = created.find((c) => c.name === 'PT ZZ Impor Satu')!;
			expect(satu.notes).toBe('Dari pameran');
			const contacts = await tx
				.select({ name: contact.name, phone: contact.phone, primary: contact.isPrimary })
				.from(contact)
				.where(eq(contact.clientId, satu.id))
				.orderBy(contact.createdAt);
			expect(contacts).toEqual([
				{ name: 'Budi', phone: '6281234567890', primary: true },
				{ name: 'Sari', phone: null, primary: false }
			]);

			// open deal keeps its next action (WIB 10:00 = 03:00 UTC)
			const [plts] = await tx
				.select({ id: deal.id, stage: deal.stage, value: deal.valueEstimate })
				.from(deal)
				.where(eq(deal.clientId, satu.id));
			expect([plts.stage, plts.value]).toEqual(['proposal', 85_000_000]);
			const [step] = await tx
				.select({ title: action.title, dueAt: action.dueAt })
				.from(action)
				.where(and(eq(action.dealId, plts.id), isNull(action.doneAt)));
			expect([step.title, step.dueAt.toISOString()]).toEqual([
				'Follow up proposal',
				'2030-10-24T03:00:00.000Z'
			]);

			// won → project in onboarding with an open first step; the deal has no open step
			const dua = created.find((c) => c.name === 'CV ZZ Impor Dua')!;
			const [proj] = await tx
				.select({ id: project.id, stage: project.stage, value: project.contractValue })
				.from(project)
				.where(eq(project.clientId, dua.id));
			expect([proj.stage, proj.value]).toEqual(['onboarding', 32_000_000]);
			const openOf = async (col: typeof action.dealId | typeof action.projectId, id: string) =>
				(
					await tx
						.select({ n: sql<number>`count(*)::int` })
						.from(action)
						.where(and(eq(col, id), isNull(action.doneAt)))
				)[0].n;
			const [duaDeal] = await tx
				.select({ id: deal.id, stage: deal.stage })
				.from(deal)
				.where(eq(deal.clientId, dua.id));
			expect([
				duaDeal.stage,
				await openOf(action.dealId, duaDeal.id),
				await openOf(action.projectId, proj.id)
			]).toEqual(['won', 0, 1]);

			// existing client: contact added, notes on the timeline
			const lamaContacts = await tx
				.select({ name: contact.name })
				.from(contact)
				.where(eq(contact.clientId, lama.id));
			expect(lamaContacts).toEqual([{ name: 'Dewi' }]);

			// the same file again: everything matches, nothing is added
			const again = await runImport(tx, SAMPLE, userId);
			expect(again).toMatchObject({
				clientsCreated: 0,
				clientsMatched: 4,
				contactsAdded: 0,
				contactsSkipped: 3,
				dealsCreated: 0,
				dealsSkipped: 3,
				projectsCreated: 0
			});
		});
	});

	it('saves nothing when one row fails while writing', async () => {
		await inRollback(async (tx, userId) => {
			// A trigger that fails the last row's deal insert (DDL is rolled back with the test)
			await tx.execute(sql`create function zz_fail_deal() returns trigger language plpgsql as $$
				begin if new.title = 'BOOM' then raise exception 'boom'; end if; return new; end $$`);
			await tx.execute(
				sql`create trigger zz_fail before insert on "deal" for each row execute function zz_fail_deal()`
			);
			const file = csv(
				row({ client_name: 'PT ZZ Impor Satu', contact_name: 'Budi' }),
				row({ client_name: 'CV ZZ Impor Dua', deal_title: 'Website', deal_stage: 'lead' }),
				row({ client_name: 'ZZ Impor Tiga', deal_title: 'BOOM', deal_stage: 'lead' })
			);
			await expect(runImport(tx, file, userId)).rejects.toThrow(/Failed query: insert into "deal"/);
			expect(await clientsLike(tx)).toEqual([]);
		});
	});

	it('refuses a file without valid rows or with an archived client', async () => {
		await inRollback(async (tx, userId) => {
			await expect(runImport(tx, csv(row({ client_name: 'X' })), userId)).rejects.toThrow(
				ServiceError
			);
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Impor Arsip' }), userId);
			await tx
				.update(client)
				.set({ archivedAt: new Date(), status: 'archived' })
				.where(eq(client.id, c.id));
			const preview = await previewImport(
				tx,
				csv(row({ client_name: 'zz impor arsip', contact_name: 'Ani' }))
			);
			expect(preview.lines[0].errors[0]).toMatch(/sudah diarsipkan/);
			expect(preview.valid).toBe(0);
		});
	});
});
