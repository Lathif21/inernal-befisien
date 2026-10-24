// Client CSV import (docs/07-IMPORT-GUIDE.md, task P1-11). Relative imports only.
// Preview and import run the same parser and checks; the import re-checks on the server and writes
// every valid row in ONE transaction, so an error leaves nothing half-imported.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { parseClientCsv, type ImportRow, type ParsedLine } from '../../import/client-csv';
import { addDays } from '../../period';
import { dayKeyWib } from '../../format';
import { clientSchema } from '../../schemas/client';
import { contactSchema } from '../../schemas/contact';
import { dealSchema, moveSchema, wonProjectSchema } from '../../schemas/deal';
import type { DbOrTx, Tx } from '../db/client';
import { action, client, contact, deal } from '../db/schema/index';
import { logActivity } from './activity';
import { createClient } from './clients';
import { saveContact } from './contacts';
import { createDeal, moveDeal } from './deals';
import { ServiceError } from './errors';

export type PreviewLine = ParsedLine & {
	/** new = created by this import; existing = already in the CRM; repeat = earlier row of this file */
	match: 'new' | 'existing' | 'repeat' | null;
};

const key = (name: string) => name.trim().toLowerCase();

/** Parse, validate and match client names (case-insensitive) against the CRM */
export async function previewImport(db: DbOrTx, text: string) {
	const parsed = parseClientCsv(text);
	const names = [...new Set(parsed.lines.flatMap((l) => (l.row ? [key(l.row.clientName)] : [])))];
	const found = names.length
		? await db
				.select({ id: client.id, name: client.name, archivedAt: client.archivedAt })
				.from(client)
				.where(inArray(sql`lower(trim(${client.name}))`, names))
		: [];
	const existing = new Map(found.map((c) => [key(c.name), c]));

	const seen = new Set<string>();
	const lines: PreviewLine[] = parsed.lines.map((l) => {
		if (!l.row) return { ...l, match: null };
		const k = key(l.row.clientName);
		const hit = existing.get(k);
		if (hit?.archivedAt) {
			return {
				...l,
				row: null,
				match: null,
				errors: [`Klien "${hit.name}" sudah diarsipkan. Pulihkan dulu di halaman Klien.`]
			};
		}
		const match = seen.has(k) ? 'repeat' : hit ? 'existing' : 'new';
		seen.add(k);
		return { ...l, match };
	});
	return {
		lines,
		fileErrors: parsed.fileErrors,
		unknownColumns: parsed.unknownColumns,
		valid: lines.filter((l) => l.row).length,
		invalid: lines.filter((l) => !l.row).length
	};
}

export type ImportSummary = {
	rows: number;
	skippedRows: number;
	clientsCreated: number;
	clientsMatched: number;
	contactsAdded: number;
	contactsSkipped: number;
	dealsCreated: number;
	dealsSkipped: number;
	projectsCreated: number;
};

/** "2026-10-24T10:00" `days` from today in WIB */
const wibAt = (days: number, time: string) => `${addDays(dayKeyWib(), days)}T${time}`;

/**
 * Import every valid row. Rows with errors are skipped (they were shown in the preview). A contact
 * or deal that the client already has (same name / title) is not added twice, so importing the
 * same file again changes nothing.
 */
export async function runImport(db: DbOrTx, text: string, userId: string): Promise<ImportSummary> {
	return db.transaction(async (tx) => {
		const preview = await previewImport(tx, text);
		if (preview.fileErrors.length) throw new ServiceError(preview.fileErrors[0]);
		const rows = preview.lines.flatMap((l) => (l.row ? [l.row] : []));
		if (rows.length === 0) throw new ServiceError('Tidak ada baris yang valid untuk diimpor.');
		return (await importRows(tx, rows, userId, preview.invalid)).summary;
	});
}

/**
 * Write checked rows (from a file or the Telegram bot) in one transaction. Clients are matched by
 * name among the ones not archived.
 */
export async function importRows(
	db: DbOrTx,
	rows: ImportRow[],
	userId: string,
	skippedRows = 0
): Promise<{ summary: ImportSummary; clientIds: string[] }> {
	return db.transaction(async (tx) => {
		const summary: ImportSummary = {
			rows: rows.length,
			skippedRows,
			clientsCreated: 0,
			clientsMatched: 0,
			contactsAdded: 0,
			contactsSkipped: 0,
			dealsCreated: 0,
			dealsSkipped: 0,
			projectsCreated: 0
		};
		const clientIds = new Map<string, string>();

		for (const row of rows) {
			const clientId = await clientFor(tx, row, clientIds, summary, userId);
			if (row.contact) await addContact(tx, clientId, row.contact, summary, userId);
			if (row.deal) await addDeal(tx, clientId, row.deal, summary, userId);
		}
		return { summary, clientIds: [...clientIds.values()] };
	});
}

async function clientFor(
	tx: Tx,
	row: ImportRow,
	ids: Map<string, string>,
	summary: ImportSummary,
	userId: string
) {
	const k = key(row.clientName);
	const known = ids.get(k);
	if (known) return known;

	const [existing] = await tx
		.select({ id: client.id })
		.from(client)
		.where(and(eq(sql`lower(trim(${client.name}))`, k), isNull(client.archivedAt)))
		.limit(1);
	if (existing) {
		summary.clientsMatched++;
		ids.set(k, existing.id);
		// Notes of an existing client are not overwritten; they go to its timeline
		if (row.notes)
			await logActivity(tx, {
				clientId: existing.id,
				type: 'note',
				body: `Catatan impor: ${row.notes}`,
				userId
			});
		return existing.id;
	}

	const created = await createClient(
		tx,
		clientSchema.parse({
			name: row.clientName,
			industry: row.industry ?? '',
			source: row.source ?? '',
			city: row.city ?? '',
			notes: row.notes ?? ''
		}),
		userId
	);
	summary.clientsCreated++;
	ids.set(k, created.id);
	return created.id;
}

async function addContact(
	tx: Tx,
	clientId: string,
	c: NonNullable<ImportRow['contact']>,
	summary: ImportSummary,
	userId: string
) {
	const [dup] = await tx
		.select({ id: contact.id })
		.from(contact)
		.where(and(eq(contact.clientId, clientId), eq(sql`lower(trim(${contact.name}))`, key(c.name))))
		.limit(1);
	if (dup) {
		summary.contactsSkipped++;
		return;
	}
	await saveContact(tx, clientId, contactSchema.parse({ ...c, isPrimary: false }), userId);
	summary.contactsAdded++;
}

async function addDeal(
	tx: Tx,
	clientId: string,
	d: NonNullable<ImportRow['deal']>,
	summary: ImportSummary,
	userId: string
) {
	const [dup] = await tx
		.select({ id: deal.id })
		.from(deal)
		.where(and(eq(deal.clientId, clientId), eq(sql`lower(trim(${deal.title}))`, key(d.title))))
		.limit(1);
	if (dup) {
		summary.dealsSkipped++;
		return;
	}

	const closed = d.stage === 'won' || d.stage === 'lost';
	// Won / lost deals pass through an open stage, so the usual move rules (project hand-off,
	// lost reason, closing steps) apply exactly as on the board
	const created = await createDeal(
		tx,
		dealSchema.parse({
			clientId,
			title: d.title,
			serviceType: d.serviceType ?? '',
			stage: closed ? (d.stage === 'won' ? 'negotiation' : 'lead') : d.stage,
			valueEstimate: d.value,
			firstStepTitle: closed ? 'Deal diimpor' : (d.nextAction?.title ?? 'Hubungi klien'),
			firstStepDue: closed ? wibAt(0, '09:00') : (d.nextAction?.due ?? wibAt(1, '10:00'))
		}),
		userId
	);
	summary.dealsCreated++;

	if (d.stage === 'won') {
		await moveDeal(
			tx,
			moveSchema.parse({ id: created.id, to: 'won', createProject: 'yes' }),
			wonProjectSchema.parse({
				projectName: d.title,
				contractValue: d.value ?? 0,
				startDate: dayKeyWib(),
				firstStepTitle: d.nextAction?.title ?? 'Kick-off meeting',
				firstStepDue: d.nextAction?.due ?? wibAt(3, '10:00')
			}),
			userId
		);
		// The placeholder step of the deal is done; the next action now lives on the project
		await tx
			.update(action)
			.set({ doneAt: new Date(), doneBy: userId })
			.where(and(eq(action.dealId, created.id), isNull(action.doneAt)));
		summary.projectsCreated++;
	} else if (d.stage === 'lost') {
		await moveDeal(
			tx,
			moveSchema.parse({
				id: created.id,
				to: 'lost',
				lostReason: 'Lainnya: diimpor sebagai deal batal'
			}),
			null,
			userId
		);
	}
}
