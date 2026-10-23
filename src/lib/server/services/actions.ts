// Steps (`action` rows). Relative imports only: shared with Trigger.dev tasks.
// P1-06 needs the read side for the boards; adding / completing steps comes in P1-07.
import { and, asc, inArray, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { action } from '../db/schema/index';

export type NextAction = { id: string; title: string; dueAt: Date; allDay: boolean };

/** A card's next action = its earliest open step (docs/02-DATA-MODEL.md). Keyed by deal / project id. */
export async function getNextActions(
	db: DbOrTx,
	{ dealIds = [], projectIds = [] }: { dealIds?: string[]; projectIds?: string[] }
) {
	const byCard = new Map<string, NextAction>();
	const pick = { id: action.id, title: action.title, dueAt: action.dueAt, allDay: action.allDay };

	if (dealIds.length) {
		const rows = await db
			.selectDistinctOn([action.dealId], { ...pick, cardId: action.dealId })
			.from(action)
			.where(and(inArray(action.dealId, dealIds), isNull(action.doneAt)))
			.orderBy(asc(action.dealId), asc(action.dueAt));
		for (const { cardId, ...next } of rows) if (cardId) byCard.set(cardId, next);
	}
	if (projectIds.length) {
		const rows = await db
			.selectDistinctOn([action.projectId], { ...pick, cardId: action.projectId })
			.from(action)
			.where(and(inArray(action.projectId, projectIds), isNull(action.doneAt)))
			.orderBy(asc(action.projectId), asc(action.dueAt));
		for (const { cardId, ...next } of rows) if (cardId) byCard.set(cardId, next);
	}
	return byCard;
}
