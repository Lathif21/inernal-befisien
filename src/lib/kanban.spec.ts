import { describe, expect, it } from 'vitest';
import { cloneLanes, findCard, moveCard, neighbours, samePlace, toLanes } from './kanban';

const card = (id: string, col: string) => ({ id, col });
const lanes = () =>
	toLanes(
		[card('a', 'lead'), card('b', 'lead'), card('c', 'lead'), card('d', 'proposal')],
		['lead', 'proposal', 'won'],
		(c) => c.col
	);

describe('kanban lanes', () => {
	it('groups by column, keeps order, and has every column', () => {
		const l = lanes();
		expect(l.lead.map((c) => c.id)).toEqual(['a', 'b', 'c']);
		expect(l.proposal.map((c) => c.id)).toEqual(['d']);
		expect(l.won).toEqual([]);
	});

	it('finds neighbours above and below', () => {
		const l = lanes();
		expect(neighbours(l.lead, 'a')).toEqual({ beforeId: null, afterId: 'b' });
		expect(neighbours(l.lead, 'b')).toEqual({ beforeId: 'a', afterId: 'c' });
		expect(neighbours(l.lead, 'c')).toEqual({ beforeId: 'b', afterId: null });
		expect(neighbours(l.proposal, 'd')).toEqual({ beforeId: null, afterId: null });
	});

	it('moves a card to the bottom of another column without touching the original', () => {
		const l = lanes();
		const next = moveCard(l, 'b', 'proposal')!;
		expect(next.lead.map((c) => c.id)).toEqual(['a', 'c']);
		expect(next.proposal.map((c) => c.id)).toEqual(['d', 'b']);
		expect(l.lead.map((c) => c.id)).toEqual(['a', 'b', 'c']);
		expect(findCard(next, 'b')).toEqual({ key: 'proposal', index: 1 });
	});

	it('moves into an empty column and within a column', () => {
		expect(moveCard(lanes(), 'a', 'won')!.won.map((c) => c.id)).toEqual(['a']);
		expect(moveCard(lanes(), 'c', 'lead', 0)!.lead.map((c) => c.id)).toEqual(['c', 'a', 'b']);
		expect(moveCard(lanes(), 'zz', 'won')).toBeNull();
		expect(moveCard(lanes(), 'a', 'nope')).toBeNull();
	});

	it('detects whether a card really moved', () => {
		const l = lanes();
		expect(samePlace(l, cloneLanes(l), 'b')).toBe(true);
		expect(samePlace(l, moveCard(l, 'b', 'lead', 0)!, 'b')).toBe(false);
		expect(samePlace(l, moveCard(l, 'b', 'proposal')!, 'b')).toBe(false);
	});
});
