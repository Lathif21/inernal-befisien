<script lang="ts">
	import { navigating } from '$app/state';
	import Sidebar from '#lib/components/layout/Sidebar.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// From the cookie on the server; the sidebar toggle overrides it right away
	let sidebar = $derived(data.sidebar);

	// Loading feedback only when a navigation takes a moment (Neon can be slow to wake up):
	// a thin bar for every load, and the page dims when it moves to another page
	let slow = $state(false);
	$effect(() => {
		if (!navigating.to) {
			slow = false;
			return;
		}
		const t = setTimeout(() => (slow = true), 150);
		return () => clearTimeout(t);
	});
	const otherPage = $derived(
		!!navigating.to && navigating.to.route.id !== navigating.from?.route.id
	);
</script>

{#if slow}
	<div
		class="fixed inset-x-0 top-0 z-60 h-0.75 overflow-hidden bg-tint"
		role="progressbar"
		aria-label="Memuat"
	>
		<div class="bf-loading h-full w-1/3 bg-accent"></div>
	</div>
{/if}

<!-- Each page renders its own <Topbar> and a `page-body` main area -->
<div class="min-h-dvh md:flex" data-sidebar={sidebar}>
	<Sidebar strategyCount={data.strategyCount} mode={sidebar} onmodechange={(m) => (sidebar = m)} />
	<div
		class={['flex min-w-0 flex-1 flex-col transition-opacity', slow && otherPage && 'opacity-60']}
		aria-busy={slow}
	>
		{@render children()}
	</div>
</div>

<style>
	.bf-loading {
		animation: bf-loading 1.1s ease-in-out infinite;
	}
	@keyframes bf-loading {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bf-loading {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}
</style>
