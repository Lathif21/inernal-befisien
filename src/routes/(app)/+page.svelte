<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Calendar from '@lucide/svelte/icons/calendar';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import PeriodFilter from '#lib/components/PeriodFilter.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import GroupedBarChart from '#lib/components/charts/GroupedBarChart.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import Money from '#lib/components/money/Money.svelte';
	import { DEAL_STAGE_META } from '#lib/constants.ts';
	import { delta } from '#lib/finance.ts';
	import { rupiah, rupiahShort } from '#lib/format.ts';
	import { nextActionState, nextActionWhen } from '#lib/next-action.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(t);
	});

	// ---------- URL (period and the chart view live in the query string) ----------
	function href(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`?${qs}`) : resolve('');
	}

	const k = $derived(data.kpis);
	const NO_PREV = 'Belum ada data periode sebelumnya';

	const UNIT = { day: 'hari', week: 'minggu', month: 'bulan', year: 'tahun' } as const;
	const subtitle = $derived.by(() => {
		const c = data.chart;
		if ('bucket' in c) {
			if (data.period.period === 'custom') return `${data.period.label} · per ${UNIT[c.bucket]}`;
			return `${c.groups.length} ${UNIT[c.bucket]} terakhir · periode terpilih ditebalkan`;
		}
		const n = c.groups.length - (c.others ? 1 : 0);
		return `${data.period.label} · ${n} klien teratas menurut pemasukan${c.others ? ' + lainnya' : ''}`;
	});

	const STATE = {
		late: { icon: CircleAlert, text: 'text-danger' },
		today: { icon: Clock, text: 'text-warning' },
		upcoming: { icon: Calendar, text: 'text-ink-3' }
	} as const;

	const maxStage = $derived(Math.max(1, ...data.pipeline.stages.map((s) => s.value)));
</script>

<Topbar title="Dashboard">
	{#snippet filters()}
		<PeriodFilter value={data.period} {href} />
	{/snippet}
</Topbar>

<main class="page-body gap-6!">
	<!-- Greeting bar -->
	<section
		class="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-panel bg-accent px-6 py-5 text-on-accent"
		aria-label="Sapaan"
	>
		<div class="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
			<h2 class="text-greeting">{data.greeting.text}</h2>
			<p class="text-small font-semibold text-on-accent-muted">
				{data.greeting.date} ·
				{#if data.strategyCount > 0}
					{data.strategyCount} langkah terlambat atau jatuh tempo hari ini
				{:else}
					Tidak ada langkah terlambat atau jatuh tempo hari ini
				{/if}
			</p>
		</div>
		<a href={resolve('strategy')} class="bf-btn bg-surface text-accent-ink hover:bg-tint-2">
			Buka Strategi
			<ArrowRight size={16} strokeWidth={2.2} />
		</a>
	</section>

	<!-- KPI tiles: all follow the period -->
	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Ringkasan periode">
		<StatTile
			label="Pemasukan"
			value={rupiahShort(k.current.income)}
			delta={delta(k.current.income, k.previous.income, true)}
			note={NO_PREV}
		/>
		<StatTile
			label="Pengeluaran"
			value={rupiahShort(k.current.expense)}
			delta={delta(k.current.expense, k.previous.expense, false)}
			note={NO_PREV}
		/>
		<StatTile
			label="Laba bersih"
			value={rupiahShort(k.current.profit)}
			variant="dark"
			delta={delta(k.current.profit, k.previous.profit, true)}
			note={k.current.margin !== null ? `Margin ${k.current.margin}%` : NO_PREV}
		/>
		<StatTile
			label="Nilai pipeline aktif"
			value={rupiahShort(k.pipeline.value)}
			delta={delta(k.pipeline.value, k.pipelinePrev.value, true)}
			note="{k.pipeline.count} deal aktif di periode ini"
		/>
	</section>

	<!-- Pemasukan vs Pengeluaran -->
	<section
		class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5"
		aria-labelledby="chart-title"
	>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex min-w-0 flex-col gap-1">
				<h2 id="chart-title" class="text-section-title">Pemasukan vs Pengeluaran</h2>
				<p class="text-small text-ink-2">{subtitle}</p>
				<p class="text-small text-ink-2">
					{data.period.label}: <Money amount={k.current.income} type="income" /> ·
					<Money amount={k.current.expense} type="expense" />
				</p>
			</div>
			<label class="flex items-center gap-2 text-small font-bold text-ink-2">
				View by
				<select
					class="min-h-10 rounded-control border border-line bg-surface px-3 text-small font-semibold text-ink"
					value={data.view}
					onchange={(e) =>
						goto(href({ view: e.currentTarget.value === 'klien' ? 'klien' : undefined }), {
							replace: true,
							reset: false
						})}
				>
					<option value="waktu">Waktu</option>
					<option value="klien">Klien</option>
				</select>
			</label>
		</div>
		<GroupedBarChart
			groups={data.chart.groups}
			label={data.view === 'klien' ? 'Klien' : 'Periode'}
		/>
	</section>

	<div class="grid gap-6 *:min-w-0 lg:grid-cols-3">
		<!-- Perlu Tindakan: late first, then today (max 6) -->
		<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-label="Perlu tindakan">
			<div class="flex items-center justify-between gap-2">
				<h2 class="text-section-title">Perlu Tindakan</h2>
				<a href={resolve('strategy')} class="bf-btn bf-btn--ghost bf-btn--sm">Buka Strategi</a>
			</div>
			{#if data.attention.length === 0}
				<p class="text-body text-ink-3">Tidak ada langkah terlambat atau hari ini. Mantap.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each data.attention as s (s.id)}
						{@const due = new Date(s.dueAt)}
						{@const st = STATE[nextActionState(due, now, s.allDay)]}
						<li class="flex items-start gap-2.5 rounded-kanban border border-line px-3 py-2.5">
							<st.icon
								size={16}
								strokeWidth={2}
								class={['mt-0.5 shrink-0', st.text]}
								aria-hidden="true"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate font-bold">{s.title}</p>
								<p class="truncate text-small text-ink-3">{s.clientName} · {s.cardTitle}</p>
							</div>
							<span class={['shrink-0 text-small font-bold', st.text]}
								>{nextActionWhen(due, now, s.allDay)}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Ringkasan Pipeline: current position, not the period -->
		<section
			class="flex flex-col gap-3 rounded-card bg-surface p-5"
			aria-label="Ringkasan pipeline"
		>
			<div class="flex items-center justify-between gap-2">
				<h2 class="text-section-title">Ringkasan Pipeline</h2>
				<span class="bf-chip">Posisi saat ini</span>
			</div>
			<p class="text-small text-ink-2">
				{data.pipeline.count} deal terbuka · <b class="text-ink">{rupiah(data.pipeline.value)}</b>
			</p>
			<ul class="flex flex-col gap-2.5">
				{#each data.pipeline.stages as s (s.stage)}
					<li class="flex flex-col gap-1">
						<div class="flex items-center gap-2 text-small">
							<span class={['size-2.5 shrink-0 rounded-full', DEAL_STAGE_META[s.stage].dot]}></span>
							<span class="min-w-0 flex-1 truncate font-semibold"
								>{DEAL_STAGE_META[s.stage].label}</span
							>
							<span class="text-ink-3 tabular-nums">{s.count} deal</span>
							<b class="w-20 text-right tabular-nums">{rupiahShort(s.value)}</b>
						</div>
						<div class="h-1.5 rounded-full bg-tint-2" aria-hidden="true">
							<div
								class={['h-full rounded-full', DEAL_STAGE_META[s.stage].dot]}
								style:width="{(s.value / maxStage) * 100}%"
							></div>
						</div>
					</li>
				{/each}
			</ul>
			<a href={resolve('pipeline')} class="mt-auto text-small font-bold text-accent-ink"
				>Buka Pipeline Sales</a
			>
		</section>

		<!-- Klien Teratas: by profit in the period -->
		<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-label="Klien teratas">
			<div class="flex flex-col gap-0.5">
				<h2 class="text-section-title">Klien Teratas</h2>
				<p class="text-small text-ink-2">Menurut laba · {data.period.label}</p>
			</div>
			{#if data.topClients.length === 0}
				<p class="text-body text-ink-3">Belum ada transaksi dibayar di periode ini.</p>
			{:else}
				<ol class="flex flex-col gap-2">
					{#each data.topClients as c, i (c.clientId)}
						<li class="flex items-center gap-3 rounded-kanban border border-line px-3 py-2.5">
							<span class="w-4 shrink-0 text-small font-extrabold text-ink-3 tabular-nums"
								>{i + 1}</span
							>
							<div class="min-w-0 flex-1">
								<a
									href={resolve(`/(app)/clients/[id]?tab=keuangan`, { id: c.clientId })}
									class="block truncate font-bold text-ink hover:text-accent-ink">{c.name}</a
								>
								<p class="text-small text-ink-3">
									<Money amount={c.income} type="income" format="short" /> ·
									<Money amount={c.expense} type="expense" format="short" />
								</p>
							</div>
							<div class="shrink-0 text-right">
								<p
									class={['font-extrabold tabular-nums', c.profit < 0 ? 'text-danger' : 'text-ink']}
								>
									{c.profit < 0 ? '−' : ''}{rupiahShort(Math.abs(c.profit))}
								</p>
								{#if c.margin !== null}<p class="text-small text-ink-3">Margin {c.margin}%</p>{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	</div>
</main>
