<script lang="ts" module>
	import { setAriaStrings, setKeyboardDragTrigger } from 'svelte-dnd-action';

	// Space lifts / drops a focused card; Enter stays free for the buttons inside it
	setKeyboardDragTrigger('space');

	// Screen-reader messages of svelte-dnd-action in Bahasa Indonesia (global, set once)
	setAriaStrings({
		dragStarted: ({ itemLabel, zoneLabel }) =>
			`${itemLabel} diangkat dari ${zoneLabel}. Gunakan tombol panah untuk memindahkan, spasi untuk melepas.`,
		movedToPosition: ({ itemLabel, zoneLabel, position, count }) =>
			`${itemLabel} di ${zoneLabel}, posisi ${position} dari ${count}.`,
		movedToZoneStart: ({ itemLabel, zoneLabel }) => `${itemLabel} di awal ${zoneLabel}.`,
		movedToZoneEnd: ({ itemLabel, zoneLabel }) => `${itemLabel} di akhir ${zoneLabel}.`,
		dropped: ({ itemLabel, zoneLabel, position, count }) =>
			`${itemLabel} dilepas di ${zoneLabel}, posisi ${position} dari ${count}.`,
		zoneActiveInstruction:
			'Tekan spasi pada kartu untuk mulai memindahkan, atau gunakan menu Pindah ke.',
		zoneDragDisabledInstruction: 'Gunakan menu Pindah ke pada kartu untuk memindahkan.'
	});

	export type KanbanColumn = {
		key: string;
		label: string;
		/** Theme class for the stage dot, e.g. "bg-stage-proposal" */
		dot: string;
		/** Starts collapsed to 92px (Deal ✓ / Batal); still a drop target */
		collapsed?: boolean;
		/** Small note under the header, e.g. "30 hari terakhir" */
		note?: string;
	};

	export type CardContext = {
		/** Column the card is in */
		column: string;
		/** Columns it can move to, for MoveMenu */
		targets: { key: string; label: string }[];
		/** Move to the bottom of another column (the "Pindah ke…" path) */
		moveTo: (key: string) => void;
		/** A move is being saved; disable the menu */
		busy: boolean;
	};
</script>

<script lang="ts" generics="T extends { id: string }">
	import { untrack, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import {
		dndzone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		TRIGGERS,
		type DndEvent
	} from 'svelte-dnd-action';
	import ChevronsLeftRight from '@lucide/svelte/icons/chevrons-left-right';
	import {
		cloneLanes,
		findCard,
		moveCard,
		neighbours,
		samePlace,
		type KanbanMove,
		type Lanes
	} from '#lib/kanban.ts';
	import { toast } from '#lib/toast.ts';

	type Props = {
		/** Accessible name of the board, e.g. "Pipeline Sales" */
		label: string;
		columns: KanbanColumn[];
		/** Server state: the cards of every column in display order */
		lanes: Lanes<T>;
		/** Card name for screen readers and menus */
		itemLabel: (item: T) => string;
		/** Column header total, e.g. rupiahShort(sum); null hides it */
		total?: (items: T[]) => string | null;
		card: Snippet<[T, CardContext]>;
		/**
		 * Persist a move. Resolve to keep it, return false or throw to roll back (throw an Error with
		 * an Indonesian message to show it). The board already shows the move while this runs.
		 */
		onMove: (move: KanbanMove) => Promise<boolean | void>;
		/** Cards can only be dropped on boards of the same type */
		type?: string;
	};

	let { label, columns, lanes, itemLabel, total, card, onMove, type = 'kanban' }: Props = $props();

	const FLIP_MS = 150;

	// What the board shows: the server lanes plus any move in flight
	let view = $state<Lanes<T>>({});
	let dragging = $state(false);
	let saving = $state(false);
	let snapshot: Lanes<T> | null = null;
	/** Server data that arrived during a drag or a save; applied once the board is idle */
	let pending: Lanes<T> | null = null;
	let expanded = $state<Record<string, boolean>>({});

	// Follow new server data (only `lanes` is tracked). Never swap the cards out from under a
	// drag or a save; keep the latest data and apply it when that finishes.
	$effect(() => {
		const next = cloneLanes(lanes);
		if (untrack(() => dragging || saving)) pending = next;
		else view = next;
	});

	function applyPending() {
		if (pending && !dragging && !saving) {
			view = pending;
			pending = null;
		}
	}

	// Touch screens move cards with the menu instead of dragging (docs/03-SCREENS.md, phone)
	let coarsePointer = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(pointer: coarse)');
		coarsePointer = mq.matches;
		const onChange = () => (coarsePointer = mq.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	const isShadow = (item: T) =>
		(item as Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME] === true;
	const realItems = (key: string) => (view[key] ?? []).filter((i) => !isShadow(i));

	async function commit(before: Lanes<T>, after: Lanes<T>, id: string) {
		const from = findCard(before, id)?.key;
		const at = findCard(after, id);
		if (!from || !at || samePlace(before, after, id)) {
			view = after;
			return;
		}
		view = after;
		saving = true;
		try {
			const ok = await onMove({ id, from, to: at.key, ...neighbours(after[at.key], id) });
			if (ok === false) {
				view = before;
				pending = null;
			}
		} catch (e) {
			view = before;
			pending = null;
			toast.error(
				e instanceof Error && e.message ? e.message : 'Kartu gagal dipindahkan. Coba lagi.'
			);
		} finally {
			saving = false;
			applyPending();
		}
	}

	function onConsider(key: string, e: CustomEvent<DndEvent<T>>) {
		if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
			snapshot = cloneLanes(view);
			dragging = true;
		}
		view[key] = e.detail.items;
	}

	function onFinalize(key: string, e: CustomEvent<DndEvent<T>>) {
		view[key] = e.detail.items;
		// finalize fires in the source and the target zone; act once, in the zone it landed in
		if (e.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ZONE) {
			if (e.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) {
				dragging = false;
				applyPending();
			}
			return;
		}
		dragging = false;
		const before = snapshot ?? cloneLanes(view);
		snapshot = null;
		void commit(before, cloneLanes(view), e.detail.info.id);
	}

	function moveTo(id: string, key: string) {
		const after = moveCard(view, id, key);
		if (after) void commit(cloneLanes(view), after, id);
	}

	function markDragged(el?: HTMLElement) {
		el?.querySelector('.bf-kcard')?.classList.add('bf-kcard--dragging');
	}
</script>

<!-- Horizontal board; on phones the columns snap one by one (docs/03-SCREENS.md) -->
<section
	class="-mx-4 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-7 lg:px-7"
	aria-label={label}
	aria-busy={saving}
>
	{#each columns as col (col.key)}
		{@const items = view[col.key] ?? []}
		{@const count = realItems(col.key).length}
		{@const collapsed = col.collapsed && !expanded[col.key]}
		{@const sum = total?.(realItems(col.key)) ?? null}
		<div
			class={[
				'bf-kcol min-h-[min(70dvh,640px)] shrink-0 snap-start',
				collapsed ? 'w-[92px]! px-2!' : 'max-sm:w-[calc(100vw-56px)]!'
			]}
			role="group"
			aria-label="{col.label}, {count} kartu"
		>
			{#if collapsed}
				<button
					type="button"
					class="flex flex-col items-center gap-2 rounded-control py-2 text-center hover:bg-tint-2/60"
					aria-expanded="false"
					onclick={() => (expanded[col.key] = true)}
					title="Buka kolom {col.label}"
				>
					<span class={['bf-dot', col.dot]}></span>
					<span class="text-small leading-tight font-extrabold">{col.label}</span>
					<span class="bf-kcol__count">{count}</span>
					{#if sum}<span class="text-[11px] font-bold text-ink-2">{sum}</span>{/if}
					<ChevronsLeftRight size={15} strokeWidth={2} class="text-ink-3" />
				</button>
			{:else}
				<div class="bf-kcol__head sticky top-0">
					<span class={['bf-dot', col.dot]}></span>
					<span class="min-w-0 truncate">{col.label}</span>
					<span class="bf-kcol__count">{count}</span>
					{#if sum}<span class="bf-kcol__total shrink-0 whitespace-nowrap">{sum}</span>{/if}
					{#if col.collapsed}
						<button
							type="button"
							class="bf-icon-btn size-7! shrink-0"
							aria-expanded="true"
							aria-label="Ciutkan kolom {col.label}"
							onclick={() => (expanded[col.key] = false)}
						>
							<ChevronsLeftRight size={14} strokeWidth={2} />
						</button>
					{/if}
				</div>
				{#if col.note}<p class="-mt-1 px-1 text-[11.5px] font-semibold text-ink-3">
						{col.note}
					</p>{/if}
			{/if}

			<!-- The drop zone fills the column (drop anywhere below the last card) and stays in collapsed
				columns with the cards hidden, so Deal ✓ / Batal accept drops. Every child of the zone must
				be a card, so the empty-state text is an overlay outside it. -->
			<div class="relative flex flex-1 flex-col">
				{#if count === 0 && !collapsed && !dragging}
					<p
						class="pointer-events-none absolute inset-x-0 top-0 rounded-kanban border border-dashed border-line-strong/60 px-3 py-6 text-center text-small text-ink-3"
					>
						Belum ada kartu
					</p>
				{/if}
				<div
					class="flex flex-1 flex-col gap-2.5 rounded-kanban"
					aria-label={col.label}
					use:dndzone={{
						items,
						type,
						flipDurationMs: FLIP_MS,
						dragDisabled: saving || coarsePointer,
						dropTargetClasses: ['bf-kcol__drop'],
						// the library's default yellow outline would override the accent outline class
						dropTargetStyle: {},
						// aim with the pointer, not the centre of the dragged card
						useCursorForDetection: true,
						transformDraggedElement: markDragged,
						delayTouchStart: true
					}}
					onconsider={(e) => onConsider(col.key, e)}
					onfinalize={(e) => onFinalize(col.key, e)}
				>
					{#each items as item (item.id)}
						<div
							animate:flip={{ duration: FLIP_MS }}
							aria-label={itemLabel(item)}
							class={collapsed ? 'sr-only' : undefined}
						>
							{#if isShadow(item)}
								<div
									class="min-h-24 rounded-kanban border-2 border-dashed border-line-strong bg-tint-2/70"
								></div>
							{:else if !collapsed}
								{@render card(item, {
									column: col.key,
									targets: columns
										.filter((c) => c.key !== col.key)
										.map((c) => ({ key: c.key, label: c.label })),
									moveTo: (key) => moveTo(item.id, key),
									busy: saving
								})}
							{:else}
								{itemLabel(item)}
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/each}
</section>

<style>
	:global(.bf-kcol__drop) {
		outline: 2px dashed var(--color-accent);
		outline-offset: 2px;
	}
</style>
