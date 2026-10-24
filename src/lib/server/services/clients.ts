// Client list, create / edit, archive and delete. Relative imports only: shared with Trigger.dev tasks.
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import type { ClientStatus, Industry } from '../../constants';
import { dayKeyWib } from '../../format';
import type { ClientInput } from '../../schemas/client';
import type { DbOrTx } from '../db/client';
import {
	action,
	client,
	contact,
	deal,
	invoice,
	project,
	strategyPlan,
	transaction,
	user
} from '../db/schema/index';
import { logActivity } from './activity';
import { paidIncome } from './projects';
import { ServiceError } from './errors';

export const CLIENT_PAGE_SIZE = 25;

export const CLIENT_SORTS = [
	'name',
	'status',
	'industry',
	'openDeals',
	'activeProjects',
	'profit',
	'created'
] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export type ClientListQuery = {
	q?: string;
	/** undefined = every status except archived */
	status?: ClientStatus;
	industry?: Industry;
	ownerId?: string;
	sort?: ClientSort;
	dir?: 'asc' | 'desc';
	page?: number;
};

/**
 * `"table"."column"`. Drizzle leaves columns unqualified when a query reads one table, and
 * inside a correlated subquery an unqualified "id" resolves to the inner table, so every
 * column in these subqueries is written out with its table.
 */
const col = (table: AnyPgTable, column: AnyPgColumn) =>
	sql`${table}.${sql.identifier(column.name)}`;

// Per-row aggregates as correlated subqueries (small tables, one round trip)
const clientId = col(client, client.id);
const openDeals = sql<number>`(select count(*)::int from ${deal} where ${col(deal, deal.clientId)} = ${clientId} and ${col(deal, deal.stage)} not in ('won', 'lost'))`;
const activeProjects = sql<number>`(select count(*)::int from ${project} where ${col(project, project.clientId)} = ${clientId} and ${col(project, project.stage)} <> 'done')`;
const profitSince = (from: string) => {
	const t = (c: AnyPgColumn) => col(transaction, c);
	return sql<number>`(select coalesce(sum(case when ${t(transaction.type)} = 'income' then ${t(transaction.amount)} else -${t(transaction.amount)} end), 0)::bigint from ${transaction} where ${t(transaction.clientId)} = ${clientId} and ${t(transaction.status)} = 'paid' and ${t(transaction.date)} >= ${from})`.mapWith(
		Number
	);
};
const primaryContact = (field: typeof contact.name | typeof contact.phone) =>
	sql<
		string | null
	>`(select ${col(contact, field)} from ${contact} where ${col(contact, contact.clientId)} = ${clientId} and ${col(contact, contact.isPrimary)} limit 1)`;

export async function listClients(db: DbOrTx, query: ClientListQuery = {}) {
	const page = Math.max(1, query.page ?? 1);
	const yearStart = `${dayKeyWib().slice(0, 4)}-01-01`;
	const profitYtd = profitSince(yearStart);

	const where: SQL[] = [];
	if (query.status === 'archived') where.push(isNotNull(client.archivedAt));
	else {
		where.push(isNull(client.archivedAt));
		if (query.status) where.push(eq(client.status, query.status));
	}
	if (query.industry) where.push(eq(client.industry, query.industry));
	if (query.ownerId) where.push(eq(client.ownerId, query.ownerId));
	const q = query.q?.trim().toLowerCase();
	if (q) {
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(
			sql`(lower(${col(client, client.name)}) like ${like} or lower(coalesce(${col(client, client.city)}, '')) like ${like} or exists (select 1 from ${contact} where ${col(contact, contact.clientId)} = ${clientId} and lower(${col(contact, contact.name)}) like ${like}))`
		);
	}
	const filter = and(...where);

	const sortExpr = {
		name: sql`lower(${client.name})`,
		status: client.status,
		industry: client.industry,
		openDeals,
		activeProjects,
		profit: profitYtd,
		created: client.createdAt
	}[query.sort ?? 'name'];
	const dir = query.dir === 'desc' ? desc : asc;

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: client.id,
				name: client.name,
				industry: client.industry,
				status: client.status,
				city: client.city,
				source: client.source,
				address: client.address,
				website: client.website,
				npwp: client.npwp,
				notes: client.notes,
				ownerId: client.ownerId,
				ownerName: user.name,
				archivedAt: client.archivedAt,
				contactName: primaryContact(contact.name),
				contactPhone: primaryContact(contact.phone),
				openDeals,
				activeProjects,
				profitYtd
			})
			.from(client)
			.leftJoin(user, eq(user.id, client.ownerId))
			.where(filter)
			.orderBy(dir(sortExpr), asc(client.id))
			.limit(CLIENT_PAGE_SIZE)
			.offset((page - 1) * CLIENT_PAGE_SIZE),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(client)
			.where(filter)
	]);

	return { rows, total, page, pageSize: CLIENT_PAGE_SIZE };
}

export type ClientRow = Awaited<ReturnType<typeof listClients>>['rows'][number];

/** People who can own clients (all users in Phase 1) */
export function listOwners(db: DbOrTx) {
	return db.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.name));
}

/** '' → null, website gets a scheme, NPWP keeps digits only */
async function toColumns(db: DbOrTx, input: ClientInput) {
	const blank = (v: string) => (v === '' ? null : v);
	if (input.ownerId) {
		const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.id, input.ownerId));
		if (!owner) throw new ServiceError('Pemilik tidak ditemukan.', 'ownerId');
	}
	const website = blank(input.website);
	return {
		name: input.name,
		industry: blank(input.industry) as Industry | null,
		source: blank(input.source) as typeof client.$inferInsert.source,
		status: input.status,
		city: blank(input.city),
		address: blank(input.address),
		website: website && !website.includes('://') ? `https://${website}` : website,
		npwp: blank(input.npwp.replace(/\D/g, '')),
		ownerId: blank(input.ownerId),
		notes: blank(input.notes)
	};
}

export async function createClient(db: DbOrTx, input: ClientInput, userId: string) {
	return db.transaction(async (tx) => {
		const values = await toColumns(tx, input);
		const [row] = await tx
			.insert(client)
			.values({ ...values, ownerId: values.ownerId ?? userId })
			.returning();
		await logActivity(tx, {
			clientId: row.id,
			type: 'system',
			body: 'Klien ditambahkan',
			userId
		});
		return row;
	});
}

export async function updateClient(db: DbOrTx, id: string, input: ClientInput, userId: string) {
	return db.transaction(async (tx) => {
		const values = await toColumns(tx, input);
		const [row] = await tx
			.update(client)
			.set(values)
			.where(and(eq(client.id, id), isNull(client.archivedAt)))
			.returning();
		if (!row) throw new ServiceError('Klien tidak ditemukan atau sudah diarsipkan.');
		await logActivity(tx, { clientId: id, type: 'system', body: 'Data klien diperbarui', userId });
		return row;
	});
}

/** docs/02-DATA-MODEL.md rule 6: only without open deals or projects */
export async function archiveClient(db: DbOrTx, id: string, userId: string) {
	return db.transaction(async (tx) => {
		const [counts] = await tx
			.select({ openDeals, activeProjects })
			.from(client)
			.where(and(eq(client.id, id), isNull(client.archivedAt)));
		if (!counts) throw new ServiceError('Klien tidak ditemukan atau sudah diarsipkan.');
		if (counts.openDeals > 0 || counts.activeProjects > 0) {
			const parts = [
				counts.openDeals > 0 && `${counts.openDeals} deal terbuka`,
				counts.activeProjects > 0 && `${counts.activeProjects} proyek aktif`
			].filter(Boolean);
			throw new ServiceError(
				`Klien tidak bisa diarsipkan karena masih punya ${parts.join(' dan ')}. Tutup dulu deal atau proyeknya.`
			);
		}
		await tx
			.update(client)
			.set({ archivedAt: new Date(), status: 'archived' })
			.where(eq(client.id, id));
		await logActivity(tx, { clientId: id, type: 'system', body: 'Klien diarsipkan', userId });
	});
}

export async function restoreClient(db: DbOrTx, id: string, userId: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.update(client)
			.set({ archivedAt: null, status: 'inactive' })
			.where(and(eq(client.id, id), isNotNull(client.archivedAt)))
			.returning({ id: client.id });
		if (!row) throw new ServiceError('Klien tidak ditemukan di arsip.');
		await logActivity(tx, {
			clientId: id,
			type: 'system',
			body: 'Klien dipulihkan dari arsip',
			userId
		});
	});
}

/**
 * Delete an archived client for good, with its contacts, deals, projects, plans, steps, timeline
 * and AI suggestions. Refused while money records exist: invoices keep their numbers and income
 * history must not disappear, so such a client stays archived.
 */
export async function deleteClient(db: DbOrTx, id: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ name: client.name, archivedAt: client.archivedAt })
			.from(client)
			.where(eq(client.id, id))
			.for('update');
		if (!row) throw new ServiceError('Klien tidak ditemukan.');
		if (!row.archivedAt) throw new ServiceError('Arsipkan klien dulu sebelum menghapusnya.');

		const [{ txns }] = await tx
			.select({ txns: sql<number>`count(*)::int` })
			.from(transaction)
			.where(eq(transaction.clientId, id));
		const [{ invoices }] = await tx
			.select({ invoices: sql<number>`count(*)::int` })
			.from(invoice)
			.where(eq(invoice.clientId, id));
		if (txns || invoices) {
			const parts = [txns && `${txns} transaksi`, invoices && `${invoices} invoice`].filter(
				Boolean
			);
			throw new ServiceError(
				`${row.name} punya ${parts.join(' dan ')}, jadi tidak bisa dihapus. Data keuangan tetap disimpan; biarkan klien ini di arsip.`
			);
		}

		// Plans point at deals and projects without cascade: their steps and the plans go first.
		// Steps of deals / projects cascade with them; contacts, activities and AI suggestions
		// cascade with the client.
		const plans = tx
			.select({ id: strategyPlan.id })
			.from(strategyPlan)
			.where(eq(strategyPlan.clientId, id));
		await tx.delete(action).where(inArray(action.planId, plans));
		await tx.delete(strategyPlan).where(eq(strategyPlan.clientId, id));
		await tx.delete(project).where(eq(project.clientId, id));
		await tx.delete(deal).where(eq(deal.clientId, id));
		await tx.delete(client).where(eq(client.id, id));
		return row;
	});
}

/** One client with owner and primary contact, for the detail page. Archived clients included. */
export async function getClient(db: DbOrTx, id: string) {
	const [row] = await db
		.select({
			id: client.id,
			name: client.name,
			industry: client.industry,
			status: client.status,
			source: client.source,
			city: client.city,
			address: client.address,
			website: client.website,
			npwp: client.npwp,
			notes: client.notes,
			ownerId: client.ownerId,
			ownerName: user.name,
			archivedAt: client.archivedAt,
			createdAt: client.createdAt,
			openDeals,
			activeProjects
		})
		.from(client)
		.leftJoin(user, eq(user.id, client.ownerId))
		.where(eq(client.id, id));
	return row ?? null;
}

export type ClientDetail = NonNullable<Awaited<ReturnType<typeof getClient>>>;

/** All deals of a client: open ones first, newest stage change first */
export function listClientDeals(db: DbOrTx, clientId: string) {
	return db
		.select({
			id: deal.id,
			title: deal.title,
			stage: deal.stage,
			serviceType: deal.serviceType,
			valueEstimate: deal.valueEstimate,
			expectedClose: deal.expectedClose,
			stageChangedAt: deal.stageChangedAt,
			lostReason: deal.lostReason
		})
		.from(deal)
		.where(eq(deal.clientId, clientId))
		.orderBy(sql`${deal.stage} in ('won', 'lost')`, desc(deal.stageChangedAt));
}

export function listClientProjects(db: DbOrTx, clientId: string) {
	return db
		.select({
			id: project.id,
			name: project.name,
			stage: project.stage,
			serviceType: project.serviceType,
			contractValue: project.contractValue,
			startDate: project.startDate,
			targetEndDate: project.targetEndDate,
			paid: paidIncome
		})
		.from(project)
		.where(eq(project.clientId, clientId))
		.orderBy(sql`${project.stage} = 'done'`, desc(project.stageChangedAt));
}
