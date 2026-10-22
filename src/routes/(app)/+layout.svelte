<script lang="ts">
	import Sidebar from '#lib/components/layout/Sidebar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<!-- Each page renders its own <Topbar> and a `page-body` main area -->
<div class="min-h-dvh md:flex">
	<Sidebar />
	<div class="flex min-w-0 flex-1 flex-col">
		{@render children()}
	</div>
</div>
