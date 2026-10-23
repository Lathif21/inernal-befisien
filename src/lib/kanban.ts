// Pure helpers for KanbanBoard: lanes are the cards of each column in display order.
// Client-safe and framework-free so they can be unit tested.

export type Lanes<T> = Record<string, T[]>;

/** What a board reports after a drop or a "Pindah ke…" choice */
export type KanbanMove = {
	id: string;
	from: string;
	to: string;
	/** Card directly above the moved card in its new column (null = top) */
	beforeId: string | null;
	/** Card directly below the moved card in its new column (null = bottom) */
	afterId: string | null;
};

/** Shallow copy: new arrays, same card objects */
export function cloneLanes<T>(lanes: Lanes<T>): Lanes<T> {
	return Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, [...v]]));
}

export function findCard<T extends { id: string }>(lanes: Lanes<T>, id: string) {
	for (const [key, items] of Object.entries(lanes)) {
		const index = items.findIndex((i) => i.id === id);
		if (index >= 0) return { key, index };
	}
	return null;
}

export function neighbours<T extends { id: string }>(items: T[], id: string) {
	const index = items.findIndex((i) => i.id === id);
	return {
		beforeId: index > 0 ? items[index - 1].id : null,
		afterId: index >= 0 && index < items.length - 1 ? items[index + 1].id : null
	};
}

/** Move a card to `toKey` at `toIndex` (default: bottom). Returns new lanes, or null if not found. */
export function moveCard<T extends { id: string }>(
	lanes: Lanes<T>,
	id: string,
	toKey: string,
	toIndex = Number.POSITIVE_INFINITY
): Lanes<T> | null {
	const at = findCard(lanes, id);
	if (!at || !(toKey in lanes)) return null;
	const next = cloneLanes(lanes);
	const [card] = next[at.key].splice(at.index, 1);
	const target = next[toKey];
	target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, card);
	return next;
}

/** True when the card sits in the same column between the same neighbours in both states */
export function samePlace<T extends { id: string }>(a: Lanes<T>, b: Lanes<T>, id: string) {
	const pa = findCard(a, id);
	const pb = findCard(b, id);
	if (!pa || !pb || pa.key !== pb.key) return false;
	const na = neighbours(a[pa.key], id);
	const nb = neighbours(b[pb.key], id);
	return na.beforeId === nb.beforeId && na.afterId === nb.afterId;
}

/** Group a flat list into lanes for the given column keys, keeping the list's order */
export function toLanes<T>(
	items: T[],
	keys: readonly string[],
	keyOf: (item: T) => string
): Lanes<T> {
	const lanes: Lanes<T> = Object.fromEntries(keys.map((k) => [k, [] as T[]]));
	for (const item of items) lanes[keyOf(item)]?.push(item);
	return lanes;
}
