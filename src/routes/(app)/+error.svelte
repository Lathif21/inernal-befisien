<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { errorCopy } from '#lib/error-copy.ts';

	const copy = $derived(errorCopy(page.status, page.error?.message));
</script>

<svelte:head>
	<title>{copy.title} · Befisien CRM</title>
</svelte:head>

<!-- Errors inside the app keep the sidebar, so the way back is always visible -->
<Topbar title={copy.title} />

<main class="page-body">
	<EmptyState illustration={page.status === 404 ? 'integration' : 'hero-base'} message={copy.text}>
		{#snippet action()}
			<div class="flex flex-wrap justify-center gap-2">
				<a href={resolve('')} class="bf-btn bf-btn--primary">Ke Dashboard</a>
				{#if page.status >= 500}
					<button type="button" class="bf-btn bf-btn--secondary" onclick={() => location.reload()}
						>Muat ulang</button
					>
				{/if}
			</div>
			<p class="font-mono text-[12px] text-ink-3">Kode {page.status}</p>
		{/snippet}
	</EmptyState>
</main>
