<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import { errorCopy } from '#lib/error-copy.ts';

	const copy = $derived(errorCopy(page.status, page.error?.message));
</script>

<svelte:head>
	<title>{copy.title} · Befisien CRM</title>
</svelte:head>

<!-- Errors outside the app shell (login, unknown top-level URLs) -->
<main
	class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-tint-2 px-4 py-10 text-center"
>
	<BrandLogo tone="light" />
	<div class="flex max-w-md flex-col items-center gap-3 rounded-card bg-surface px-6 py-10">
		<p class="font-mono text-[13px] font-bold text-ink-3">{page.status}</p>
		<h1 class="text-page-title">{copy.title}</h1>
		<p class="text-body text-ink-2">{copy.text}</p>
		<a href={resolve('')} class="bf-btn bf-btn--primary mt-2">Ke Befisien CRM</a>
	</div>
</main>
