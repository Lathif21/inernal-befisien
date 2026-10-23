// Client-safe finance helpers shared by Keuangan, Detail Klien and (P1-10) the Dashboard.

export type Delta = { pct: number; upIsGood: boolean };

/**
 * "vs periode sebelumnya" for a StatTile. Undefined when the previous period is zero, because a
 * percentage of nothing means nothing; the tile then shows its note instead.
 */
export function delta(current: number, previous: number, upIsGood: boolean): Delta | undefined {
	if (previous === 0) return undefined;
	return { pct: ((current - previous) / Math.abs(previous)) * 100, upIsGood };
}
