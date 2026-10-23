<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'value' | 'type'> & {
		/** Whole Rupiah; null = empty */
		value: number | null;
		/** Name of the hidden field that posts the plain number */
		name: string;
	};

	let { value = $bindable(), name, id, ...rest }: Props = $props();

	const grouping = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
	const show = (v: number | null) => (v === null || v === undefined ? '' : grouping.format(v));

	let text = $state(show(value));
	// Follow outside changes (form reset / edit) without fighting the person typing
	$effect(() => {
		const formatted = show(value);
		if (digits(text) !== (value === null ? '' : String(value))) text = formatted;
	});

	function digits(s: string) {
		return s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		const d = digits(e.currentTarget.value).slice(0, 15);
		value = d === '' ? null : Number(d);
		text = show(value);
	}
</script>

<!-- Rupiah input: "Rp" prefix, dot thousands while typing, posts whole Rupiah in a hidden field -->
<div
	class="flex min-h-(--size-touch) items-center gap-2 rounded-control border border-line bg-surface px-3.5 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-accent has-aria-invalid:border-danger-fill"
>
	<span class="text-body font-bold text-ink-2" aria-hidden="true">Rp</span>
	<input
		{...rest}
		{id}
		type="text"
		inputmode="numeric"
		autocomplete="off"
		value={text}
		{oninput}
		class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14.5px] font-semibold text-ink tabular-nums outline-none"
	/>
	<input type="hidden" {name} value={value ?? ''} />
</div>
