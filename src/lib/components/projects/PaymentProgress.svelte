<script lang="ts">
	import { rupiahShort } from '#lib/format.ts';

	type Props = {
		/** Paid income so far (whole Rupiah) */
		paid: number;
		/** Contract value; null = not set, so there is nothing to measure against */
		contractValue: number | null;
	};

	let { paid, contractValue }: Props = $props();

	const pct = $derived(
		contractValue ? Math.min(100, Math.round((paid / contractValue) * 100)) : null
	);
	// "Rp 96 jt / 120 jt" (docs/03-SCREENS.md §5)
	const label = $derived(
		contractValue
			? `${rupiahShort(paid)} / ${rupiahShort(contractValue).replace(/^Rp\s/, '')}`
			: `${rupiahShort(paid)} diterima`
	);
</script>

<!-- Payment progress = paid income ÷ contract value (bf-progress, KanbanCard README) -->
<div class="flex flex-col gap-1">
	<div class="flex items-baseline justify-between gap-2 text-small">
		<span class="min-w-0 truncate font-semibold text-ink-2">Pembayaran</span>
		<span class="shrink-0 font-mono text-[12px] font-medium whitespace-nowrap text-ink"
			>{label}</span
		>
	</div>
	{#if pct !== null}
		<div
			class="bf-progress"
			role="progressbar"
			aria-label="Pembayaran diterima"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={pct}
			aria-valuetext="{pct}% · {label}"
		>
			<span class={[pct === 100 && 'bg-success-fill!']} style:width="{pct}%"></span>
		</div>
	{/if}
</div>
