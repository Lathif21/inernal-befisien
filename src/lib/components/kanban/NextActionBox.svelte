<script lang="ts">
	import Calendar from '@lucide/svelte/icons/calendar';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import Plus from '@lucide/svelte/icons/plus';
	import { nextActionState, nextActionWhen } from '#lib/next-action.ts';

	type Props = {
		/** The earliest open step; null = none */
		step: { title: string; dueAt: Date; allDay?: boolean } | null;
		/** Current time, so a whole board shares one clock */
		now?: Date;
		/** Shows the dashed "+ Tambah langkah berikutnya" button when there is no step */
		onadd?: () => void;
		/** Won, lost or done cards may have no step; the box is then hidden */
		allowNone?: boolean;
	};

	let { step, now = new Date(), onadd, allowNone = false }: Props = $props();

	const state = $derived(step ? nextActionState(step.dueAt, now, step.allDay) : null);
	const when = $derived(step ? nextActionWhen(step.dueAt, now, step.allDay) : '');
	const ICON = { late: CircleAlert, today: Clock, upcoming: Calendar } as const;
</script>

<!-- Title stays ink; only the time line takes the state colour (docs/design-system/components/NextActionBox) -->
{#if step && state}
	{@const Icon = ICON[state]}
	<div class={['bf-next', `bf-next--${state}`]}>
		<Icon size={15} strokeWidth={2} class="shrink-0" aria-hidden="true" />
		<span class="min-w-0">
			<span class="bf-next__title truncate">{step.title}</span>
			<span class="bf-next__when">{when}</span>
		</span>
	</div>
{:else if !allowNone}
	{#if onadd}
		<button type="button" class="bf-next bf-next--none" onclick={onadd}>
			<Plus size={15} strokeWidth={2.2} aria-hidden="true" />
			Tambah langkah berikutnya
		</button>
	{:else}
		<p class="bf-next bf-next--none cursor-default">Belum ada langkah berikutnya</p>
	{/if}
{/if}
