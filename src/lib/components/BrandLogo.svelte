<script lang="ts">
	type Props = {
		/** Second line under BEFISIEN */
		subtitle?: string;
		/** `dark` = on navy / accent (white wordmark, sky subtitle) */
		tone?: 'dark' | 'light';
		/** Hide the wordmark (collapsed sidebar) */
		markOnly?: boolean;
	};

	let { subtitle = 'CRM & KEUANGAN', tone = 'dark', markOnly = false }: Props = $props();
</script>

<span class="inline-flex items-center gap-2.5">
	<img src="/logo-mark.svg" alt="" width="28" height="34" class="h-[34px] w-7 shrink-0" />
	{#if !markOnly}
		<span class="flex flex-col leading-none">
			<span
				class={[
					'text-[17px] font-extrabold tracking-[0.02em]',
					tone === 'dark' ? 'text-on-accent' : 'text-ink'
				]}>BEFISIEN</span
			>
			<span
				class={[
					'mt-1 text-[10.5px] font-semibold tracking-[0.08em]',
					tone === 'dark' ? 'text-sky' : 'text-accent-ink'
				]}>{subtitle}</span
			>
		</span>
	{/if}
</span>
