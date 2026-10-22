<script lang="ts">
	import { rupiah, rupiahShort } from '#lib/format.ts';

	type Props = {
		/** Whole Rupiah, always positive for transactions (direction comes from `type`) */
		amount: number;
		/** income → green `+`, expense → red `−`; meaning never relies on colour alone */
		type?: 'income' | 'expense';
		/** `short` for cards, tiles and charts; `full` for tables and forms */
		format?: 'full' | 'short';
		class?: string;
	};

	let { amount, type, format = 'full', class: className }: Props = $props();

	const text = $derived((format === 'short' ? rupiahShort : rupiah)(Math.abs(amount)));
	const number = $derived(text.replace(/^Rp /, ''));
	const sign = $derived(type === 'income' ? '+' : type === 'expense' ? '−' : amount < 0 ? '−' : '');
	const label = $derived(
		`${type === 'income' ? 'Masuk ' : type === 'expense' ? 'Keluar ' : amount < 0 ? 'minus ' : ''}${text}`
	);
</script>

<span
	class={[
		'whitespace-nowrap tabular-nums',
		type === 'income' && 'bf-amount--in',
		type === 'expense' && 'bf-amount--out',
		className
	]}
	aria-label={label}
	><span aria-hidden="true"
		>{sign}<span class={!type ? 'text-ink-2' : undefined}>Rp</span>&nbsp;<span
			class={!type ? 'text-ink' : undefined}>{number}</span
		></span
	></span
>
