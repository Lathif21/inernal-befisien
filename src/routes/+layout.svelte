<script lang="ts">
	import '../app.css';
	import Toaster from '#lib/components/Toaster.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/logo-mark.svg" type="image/svg+xml" />
</svelte:head>

{@render children()}
<Toaster />
