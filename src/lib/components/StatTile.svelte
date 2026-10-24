<script lang="ts">
	type Delta = {
		/** Percentage change vs the previous period, e.g. 35 or -12 */
		pct: number;
		/** Whether "up" is good (income) or bad (costs) */
		upIsGood: boolean;
	};

	type Props = {
		label: string;
		/** Already formatted with rupiahShort(); null shows the [XX] placeholder */
		value: string | null;
		delta?: Delta;
		/** Neutral note instead of a delta, e.g. "18 deal terbuka" */
		note?: string;
		/** `dark` = the one profit tile per row; `planned` = Pemasukan Direncanakan */
		variant?: 'default' | 'dark' | 'planned';
	};

	let { label, value, delta, note, variant = 'default' }: Props = $props();

	const up = $derived(delta ? delta.pct >= 0 : false);
	const good = $derived(delta ? (up ? delta.upIsGood : !delta.upIsGood) : false);
	const deltaText = $derived(delta ? `${up ? '▲' : '▼'} ${Math.abs(Math.round(delta.pct))}%` : '');
</script>

<!-- Narrow tiles (phones, 4 per row beside the full sidebar) drop "vs periode sebelumnya"
     visually, so the chip stays on one line -->
<div
	class={[
		'bf-stat @container',
		variant === 'dark' && 'bf-stat--dark',
		variant === 'planned' && 'border border-dashed border-line-strong'
	]}
>
	<span class="bf-stat__label">{label}</span>
	<span class={['bf-stat__value', variant === 'planned' && 'text-accent-ink']}
		>{value ?? '[XX]'}</span
	>
	{#if delta && value !== null}
		<span
			class={[
				'bf-stat__delta',
				variant !== 'dark' && (good ? 'bf-stat__delta--good' : 'bf-stat__delta--bad')
			]}>{deltaText}<span class="ml-1 @max-[15rem]:sr-only">vs periode sebelumnya</span></span
		>
	{:else if note}
		<span class="bf-stat__delta bf-stat__delta--neutral">{note}</span>
	{/if}
</div>
