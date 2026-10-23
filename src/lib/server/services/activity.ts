// Activity timeline. Relative imports only: services are shared with Trigger.dev tasks.
import { desc, eq, sql } from 'drizzle-orm';
import type { ActivityType } from '../../constants';
import { wibLocalToDate } from '../../format';
import type { NoteInput } from '../../schemas/activity';
import type { DbOrTx } from '../db/client';
import { activity, client, deal, project, user } from '../db/schema/index';
import { ServiceError } from './errors';

export const ACTIVITY_PAGE_SIZE = 20;

export type LogActivityInput = {
	/** Always required, so the client timeline is one query */
	clientId: string;
	dealId?: string | null;
	projectId?: string | null;
	type: ActivityType;
	/** Note text, or a generated message such as "Pindah dari Proposal → Negosiasi" (Bahasa Indonesia) */
	body?: string | null;
	/** Structured details, e.g. { from: 'proposal', to: 'negotiation' } */
	meta?: Record<string, unknown> | null;
	/** null for system events */
	userId?: string | null;
	/** Defaults to now; set for back-dated notes */
	occurredAt?: Date;
};

/**
 * Append one entry to a client's timeline. Pass the open transaction (`tx`) when the activity
 * belongs to a multi-step write, so the log and the change commit or roll back together.
 */
export async function logActivity(db: DbOrTx, input: LogActivityInput) {
	const [row] = await db
		.insert(activity)
		.values({
			clientId: input.clientId,
			dealId: input.dealId ?? null,
			projectId: input.projectId ?? null,
			type: input.type,
			body: input.body ?? null,
			meta: input.meta ?? null,
			userId: input.userId ?? null,
			...(input.occurredAt ? { occurredAt: input.occurredAt } : {})
		})
		.returning();
	return row;
}

/** A client's timeline, newest first (by when it happened, then when it was written) */
export async function listActivities(
	db: DbOrTx,
	clientId: string,
	{ page = 1, pageSize = ACTIVITY_PAGE_SIZE }: { page?: number; pageSize?: number } = {}
) {
	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: activity.id,
				type: activity.type,
				body: activity.body,
				meta: activity.meta,
				occurredAt: activity.occurredAt,
				userName: user.name,
				dealTitle: deal.title,
				projectName: project.name
			})
			.from(activity)
			.leftJoin(user, eq(user.id, activity.userId))
			.leftJoin(deal, eq(deal.id, activity.dealId))
			.leftJoin(project, eq(project.id, activity.projectId))
			.where(eq(activity.clientId, clientId))
			.orderBy(desc(activity.occurredAt), desc(activity.createdAt))
			.limit(pageSize)
			.offset((Math.max(1, page) - 1) * pageSize),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(activity)
			.where(eq(activity.clientId, clientId))
	]);
	return { rows, total, page: Math.max(1, page), pageSize };
}

export type ActivityRow = Awaited<ReturnType<typeof listActivities>>['rows'][number];

/** Manual note / call / meeting / WhatsApp / email from the Aktivitas tab */
export async function addNote(db: DbOrTx, clientId: string, input: NoteInput, userId: string) {
	const [exists] = await db.select({ id: client.id }).from(client).where(eq(client.id, clientId));
	if (!exists) throw new ServiceError('Klien tidak ditemukan.');
	return logActivity(db, {
		clientId,
		type: input.type,
		body: input.body,
		userId,
		occurredAt: (input.occurredAt && wibLocalToDate(input.occurredAt)) || undefined
	});
}
