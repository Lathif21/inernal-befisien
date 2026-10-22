// Activity timeline writes. Relative imports only: services are shared with Trigger.dev tasks.
import type { ActivityType } from '../../constants';
import type { DbOrTx } from '../db/client';
import { activity } from '../db/schema/index';

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
