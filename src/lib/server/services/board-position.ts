// Card order inside kanban columns (docs/02-DATA-MODEL.md "Ordering inside kanban columns"), shared
// by the deal and project boards. Relative imports only: shared with Trigger.dev.
import { and, eq, inArray, max, min, ne } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import type { Tx } from '../db/client';
import { deal, project } from '../db/schema/index';

type BoardTable = typeof deal | typeof project;

/**
 * Fractional key for a card placed between `beforeId` (above) and `afterId` (below) in `stage`.
 * Unknown or stale neighbours (someone else moved them meanwhile) put the card at the bottom.
 */
export async function positionBetween(
	tx: Tx,
	table: BoardTable,
	stage: string,
	beforeId: string | null,
	afterId: string | null,
	movingId?: string
) {
	// The two tables share id / stage / position; typed through the deal table
	const t = table as typeof deal;
	const ids = [beforeId, afterId].filter((v): v is string => !!v);
	const neighbours = ids.length
		? await tx
				.select({ id: t.id, stage: t.stage, position: t.position })
				.from(t)
				.where(inArray(t.id, ids))
		: [];
	const pos = (id: string | null) =>
		id ? (neighbours.find((n) => n.id === id && n.stage === stage)?.position ?? undefined) : null;
	const a = pos(beforeId);
	const b = pos(afterId);

	if (a === undefined || b === undefined || (a !== null && b !== null && a >= b))
		return bottomOf(tx, table, stage, movingId);
	if (a === null && b === null) return bottomOf(tx, table, stage, movingId);
	return generateKeyBetween(a, b);
}

export async function bottomOf(tx: Tx, table: BoardTable, stage: string, exceptId?: string) {
	const t = table as typeof deal;
	const [{ last }] = await tx
		.select({ last: max(t.position) })
		.from(t)
		.where(and(eq(t.stage, stage as never), exceptId ? ne(t.id, exceptId) : undefined));
	return generateKeyBetween(last ?? null, null);
}

export async function topOf(tx: Tx, table: BoardTable, stage: string) {
	const t = table as typeof deal;
	const [{ first }] = await tx
		.select({ first: min(t.position) })
		.from(t)
		.where(eq(t.stage, stage as never));
	return generateKeyBetween(null, first ?? null);
}
