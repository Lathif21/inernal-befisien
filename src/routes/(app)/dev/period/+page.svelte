<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PeriodFilter from '#lib/components/PeriodFilter.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Same URL with some params changed; other filters (here ?q=) survive */
	function href(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`dev/period?${qs}`) : resolve('dev/period');
	}

	const rows = $derived([
		['period', data.period.period],
		['from – to', `${data.period.from} – ${data.period.to} (${data.period.days} hari)`],
		['prevFrom – prevTo', `${data.period.prevFrom} – ${data.period.prevTo}`],
		['prevAnchor / nextAnchor', `${data.period.prevAnchor} / ${data.period.nextAnchor}`],
		['nextInFuture', String(data.period.nextInFuture)],
		['bucket / seriesFrom', `${data.period.bucket} / ${data.period.seriesFrom}`],
		['fromInstant', new Date(data.period.fromInstant).toISOString()],
		['toInstant (exclusive)', new Date(data.period.toInstant).toISOString()],
		['other param q', data.other || '–']
	]);
</script>

<Topbar title="Demo Periode">
	{#snippet filters()}
		<PeriodFilter value={data.period} {href} />
	{/snippet}
</Topbar>

<main class="page-body">
	<section class="rounded-card bg-surface p-5" aria-label="Hasil resolvePeriod">
		<h2 class="text-section-title">resolvePeriod()</h2>
		<p class="mt-1 mb-3 text-small text-ink-2">
			Data contoh untuk filter periode (P1-07b), hanya di mode dev.
		</p>
		<dl
			class="grid gap-x-6 gap-y-2 font-mono text-[12.5px] sm:grid-cols-[220px_1fr]"
			data-testid="resolved"
		>
			{#each rows as [k, v] (k)}
				<dt class="text-ink-2">{k}</dt>
				<dd data-key={k}>{v}</dd>
			{/each}
		</dl>
	</section>
</main>
