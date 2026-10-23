<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';

	type Props = {
		/** The card's name, for the button label */
		itemLabel: string;
		/** Columns the card can move to (the current one excluded) */
		targets: { key: string; label: string }[];
		onmove: (key: string) => void;
		disabled?: boolean;
	};

	let { itemLabel, targets, onmove, disabled = false }: Props = $props();
</script>

<!-- "Pindah ke…": the keyboard / touch alternative to drag and drop (docs/03-SCREENS.md) -->
<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="bf-icon-btn size-8! shrink-0"
		aria-label="Menu {itemLabel}"
		{disabled}
		onpointerdown={(e: PointerEvent) => e.stopPropagation()}
	>
		<Ellipsis size={16} strokeWidth={2} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			align="end"
			sideOffset={6}
			class="z-50 min-w-52 rounded-kanban border border-line bg-surface p-1.5 shadow-raised"
		>
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading class="px-3 pt-1.5 pb-1 text-small font-bold text-ink-2"
					>Pindah ke…</DropdownMenu.GroupHeading
				>
				{#each targets as t (t.key)}
					<DropdownMenu.Item
						class="flex min-h-(--size-touch) cursor-pointer items-center rounded-control px-3 text-body font-semibold data-highlighted:bg-tint-2"
						onSelect={() => onmove(t.key)}
					>
						{t.label}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
