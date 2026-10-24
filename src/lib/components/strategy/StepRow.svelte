<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Avatar from '#lib/components/Avatar.svelte';
	import { dateID } from '#lib/format.ts';
	import { nextActionState } from '#lib/next-action.ts';

	export type RowStep = {
		title: string;
		dueAt: Date | string;
		allDay: boolean;
		doneAt: Date | string | null;
		assigneeName: string | null;
	};

	type Props = {
		step: RowStep;
		now: Date;
		/** Tick off (open steps only) */
		oncomplete?: () => void;
		/** Reorder inside the plan; omitted = no arrows */
		onmove?: (direction: 'up' | 'down') => void;
		canUp?: boolean;
		canDown?: boolean;
		/** "Ubah langkah" (open steps only) and "Hapus langkah" in the row menu; omitted = no menu */
		onedit?: () => void;
		ondelete?: () => void;
	};

	let {
		step,
		now,
		oncomplete,
		onmove,
		canUp = false,
		canDown = false,
		onedit,
		ondelete
	}: Props = $props();

	const menu = $derived(
		[
			!step.doneAt && onedit && { label: 'Ubah langkah', run: onedit, danger: false },
			ondelete && { label: 'Hapus langkah', run: ondelete, danger: true }
		].filter((i) => !!i)
	);

	const due = $derived(new Date(step.dueAt));
	const state = $derived(
		step.doneAt
			? 'done'
			: ({ late: 'late', today: 'today', upcoming: 'next' } as const)[
					nextActionState(due, now, step.allDay)
				]
	);
	const when = $derived(step.allDay ? dateID(due) : dateID(due, 'datetime'));
</script>

<!-- bf-step: done ✓ green, late ! red, today amber ring, upcoming grey ring (docs/design-system/components/PlanCard) -->
<li class={['bf-step', `bf-step--${state}`]}>
	{#if state === 'done'}
		<span class="bf-step__icon" aria-label="Selesai"><Check size={13} strokeWidth={3} /></span>
	{:else}
		<button
			type="button"
			class="bf-step__icon bf-hit cursor-pointer hover:outline-2 hover:outline-success-fill"
			aria-label="Tandai selesai: {step.title}"
			title="Tandai selesai"
			disabled={!oncomplete}
			onclick={oncomplete}>{state === 'late' ? '!' : ''}</button
		>
	{/if}
	<span class="bf-step__title">{step.title}</span>
	<span class="bf-step__when">{when}</span>
	{#if step.assigneeName}<Avatar name={step.assigneeName} size={24} />{/if}
	{#if onmove}
		<span class="flex flex-col">
			<button
				type="button"
				class="rounded-sm px-0.5 text-ink-3 hover:text-ink disabled:invisible"
				aria-label="Naikkan: {step.title}"
				disabled={!canUp}
				onclick={() => onmove('up')}><ChevronUp size={14} strokeWidth={2.2} /></button
			>
			<button
				type="button"
				class="rounded-sm px-0.5 text-ink-3 hover:text-ink disabled:invisible"
				aria-label="Turunkan: {step.title}"
				disabled={!canDown}
				onclick={() => onmove('down')}><ChevronDown size={14} strokeWidth={2.2} /></button
			>
		</span>
	{/if}
	{#if menu.length}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="bf-hit inline-flex size-7 shrink-0 items-center justify-center rounded-control text-ink-3 hover:bg-tint-2 hover:text-ink"
				aria-label="Menu langkah {step.title}"
			>
				<Ellipsis size={16} strokeWidth={2} />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={6}
					class="z-50 min-w-44 rounded-kanban border border-line bg-surface p-1.5 shadow-raised"
				>
					{#each menu as item (item.label)}
						<DropdownMenu.Item
							class={[
								'flex min-h-(--size-touch) cursor-pointer items-center gap-2 rounded-control px-3 text-body font-semibold data-highlighted:bg-tint-2',
								item.danger && 'text-danger'
							]}
							onSelect={item.run}
						>
							{#if item.danger}<Trash size={15} strokeWidth={1.9} />{:else}<Pencil
									size={15}
									strokeWidth={1.9}
								/>{/if}
							{item.label}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	{/if}
</li>
