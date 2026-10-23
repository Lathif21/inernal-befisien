<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	type Props = {
		page: number;
		total: number;
		pageSize: number;
		/** Link for a page; list pages keep the page in the URL */
		href: (page: number) => string;
		/** Noun for the info text: "Menampilkan klien 1–25 dari 40" */
		noun: string;
		size?: 'md' | 'sm';
	};

	let { page, total, pageSize, href, noun, size = 'md' }: Props = $props();

	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const to = $derived(Math.min(total, page * pageSize));

	/** At most 7 buttons: 1 … 4 5 6 … 10 */
	const items = $derived.by((): (number | 'gap')[] => {
		if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
		const start = Math.max(2, Math.min(page - 1, pages - 4));
		const end = Math.min(pages - 1, Math.max(page + 1, 5));
		return [
			1,
			...(start > 2 ? ['gap' as const] : []),
			...Array.from({ length: end - start + 1 }, (_, i) => start + i),
			...(end < pages - 1 ? ['gap' as const] : []),
			pages
		];
	});
</script>

<!-- Hidden when everything fits on one page (docs/design-system/components/Pager) -->
{#if pages > 1}
	<nav class="bf-pager bf-pager--{size}" aria-label="Halaman {noun}">
		<span class="bf-pager__info">Menampilkan {noun} {from}–{to} dari {total}</span>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- callers build `href` with resolve() -->
		<a
			href={page > 1 ? href(page - 1) : undefined}
			aria-disabled={page <= 1 ? 'true' : undefined}
			aria-label="Halaman sebelumnya"
			data-sveltekit-noscroll
		>
			<ChevronLeft size={16} strokeWidth={2.2} />
			{#if size === 'md'}<span class="max-sm:hidden">Sebelumnya</span>{/if}
		</a>
		{#each items as item, i (item === 'gap' ? `gap-${i}` : item)}
			{#if item === 'gap'}
				<span class="px-1 text-ink-3" aria-hidden="true">…</span>
			{:else}
				<a
					href={href(item)}
					aria-current={item === page ? 'page' : undefined}
					aria-label="Halaman {item}"
					data-sveltekit-noscroll>{item}</a
				>
			{/if}
		{/each}
		<a
			href={page < pages ? href(page + 1) : undefined}
			aria-disabled={page >= pages ? 'true' : undefined}
			aria-label="Halaman berikutnya"
			data-sveltekit-noscroll
		>
			{#if size === 'md'}<span class="max-sm:hidden">Berikutnya</span>{/if}
			<ChevronRight size={16} strokeWidth={2.2} />
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</nav>
{/if}
