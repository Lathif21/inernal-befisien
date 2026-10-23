<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
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
	};

	let { step, now, oncomplete, onmove, canUp = false, canDown = false }: Props = $props();

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
</li>
