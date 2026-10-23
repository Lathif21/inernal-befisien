<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from '#lib/components/Avatar.svelte';

	type Props = {
		client: string;
		/** Service chip label, e.g. "AI Agent" */
		service?: string | null;
		title: string;
		/** Already formatted with rupiahShort() */
		value?: string | null;
		/** Owner's name for the avatar */
		owner?: string | null;
		/** Whole days in the current column */
		daysInStage?: number;
		/** Opens the card drawer; omitted = not clickable */
		onopen?: () => void;
		/** Next action box (NextActionBox) */
		next?: Snippet;
		/** Extra rows between value and next action, e.g. the project payment progress */
		extra?: Snippet;
		/** "⋯" menu (MoveMenu) in the footer */
		menu?: Snippet;
	};

	let { client, service, title, value, owner, daysInStage, onopen, next, extra, menu }: Props =
		$props();
</script>

<!-- Card order: client + service, title, value, next action, footer (docs/design-system/components/KanbanCard).
	Clicking anywhere on the card opens it; the title button is the keyboard path. The card is not one big
	button because svelte-dnd-action does not start a drag on buttons. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
	class={['bf-kcard', onopen && 'cursor-pointer']}
	onclick={(e) => {
		// ignore clicks on the menu, links and the title button itself (it handles its own click)
		if (!onopen || (e.target as HTMLElement).closest('button, a, [role="menu"]')) return;
		onopen();
	}}
>
	<div class="flex items-center gap-2">
		<span class="bf-kcard__client">{client}</span>
		{#if service}<span class="bf-chip bf-chip--service shrink-0">{service}</span>{/if}
	</div>
	<h3 class="bf-kcard__title">
		{#if onopen}
			<button type="button" class="text-left hover:text-accent-ink" onclick={onopen}>{title}</button
			>
		{:else}{title}{/if}
	</h3>
	{#if value}<span class="bf-kcard__value">{value}</span>{/if}
	{#if extra}{@render extra()}{/if}
	{#if next}{@render next()}{/if}
	<div class="bf-kcard__foot">
		{#if owner}<Avatar name={owner} size={24} />{/if}
		{#if daysInStage !== undefined}
			<span class="min-w-0 flex-1 truncate"
				>{daysInStage === 0 ? 'Baru di tahap ini' : `${daysInStage} hari di tahap ini`}</span
			>
		{:else}<span class="flex-1"></span>{/if}
		{#if menu}{@render menu()}{/if}
	</div>
</article>
