<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import StatTile from '#lib/components/StatTile.svelte';
	import FinanceTabs from '#lib/components/finance/FinanceTabs.svelte';
	import TransactionFormDrawer from '#lib/components/finance/TransactionFormDrawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { rupiah, rupiahShort } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const MONTHS = [
		'Januari',
		'Februari',
		'Maret',
		'April',
		'Mei',
		'Juni',
		'Juli',
		'Agustus',
		'September',
		'Oktober',
		'November',
		'Desember'
	];
	const pl = $derived(data.pl);
	const yearHref = (y: number) =>
		y === data.thisYear ? resolve('finance/laba-rugi') : resolve(`finance/laba-rugi?year=${y}`);
	const share = (n: number) =>
		pl.total.overhead > 0 ? Math.round((n / pl.total.overhead) * 100) : 0;

	let drawer: ReturnType<typeof TransactionFormDrawer> | undefined = $state();
</script>

<Topbar title="Keuangan">
	{#snippet filters()}
		<div class="bf-period">
			<a
				class="bf-icon-btn"
				href={yearHref(pl.year - 1)}
				aria-label="Tahun sebelumnya"
				data-sveltekit-reset="false"
			>
				<ChevronLeft size={15} strokeWidth={2.4} />
			</a>
			<span class="bf-period__label" aria-live="polite">Tahun {pl.year}</span>
			{#if pl.year >= data.thisYear}
				<span
					class="bf-icon-btn opacity-60"
					role="link"
					aria-disabled="true"
					aria-label="Tahun berikutnya"
				>
					<ChevronRight size={15} strokeWidth={2.4} class="text-ink-disabled" />
				</span>
			{:else}
				<a
					class="bf-icon-btn"
					href={yearHref(pl.year + 1)}
					aria-label="Tahun berikutnya"
					data-sveltekit-reset="false"
				>
					<ChevronRight size={15} strokeWidth={2.4} />
				</a>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<button
			type="button"
			class="bf-btn bf-btn--primary"
			onclick={() => drawer?.openCreate({ type: 'expense' })}
		>
			<Plus size={18} strokeWidth={2} />
			Transaksi
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	<FinanceTabs current="laba-rugi" />

	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Ringkasan tahun {pl.year}">
		<StatTile label="Pemasukan" value={rupiahShort(pl.total.income)} note="Tahun {pl.year}" />
		<StatTile
			label="Biaya langsung"
			value={rupiahShort(pl.total.direct)}
			note="Pengeluaran proyek & klien"
		/>
		<StatTile label="Overhead" value={rupiahShort(pl.total.overhead)} note="Biaya kantor" />
		<StatTile
			label="Laba bersih"
			value={rupiahShort(pl.total.net)}
			variant="dark"
			note={pl.total.margin !== null ? `Margin ${pl.total.margin}%` : 'Belum ada pemasukan'}
		/>
	</section>

	<section
		class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5"
		aria-labelledby="pl-title"
	>
		<div class="flex flex-col gap-1">
			<h2 id="pl-title" class="text-section-title">Laba Rugi {pl.year}</h2>
			<p class="text-small text-ink-2">
				Dari transaksi yang sudah dibayar, per tanggal bayar. Laba kotor = pemasukan − biaya
				langsung; laba bersih = laba kotor − overhead.
			</p>
		</div>
		<div class="bf-table-wrap min-w-0">
			<table class="bf-table min-w-200">
				<thead>
					<tr>
						<th scope="col">Bulan</th>
						<th scope="col" class="num">Pemasukan</th>
						<th scope="col" class="num">Biaya langsung</th>
						<th scope="col" class="num">Laba kotor</th>
						<th scope="col" class="num">Overhead</th>
						<th scope="col" class="num">Laba bersih</th>
						<th scope="col" class="num">Margin</th>
					</tr>
				</thead>
				<tbody>
					{#each pl.months as m (m.month)}
						{@const future = m.month > data.lastMonth}
						<tr class={future ? 'text-ink-3' : undefined}>
							<td class="font-semibold">{MONTHS[m.month - 1]}</td>
							{#if future}
								<td class="num" colspan="6">–</td>
							{:else}
								<td class="num">{rupiah(m.income)}</td>
								<td class="num">{rupiah(m.direct)}</td>
								<td class={['num', m.gross < 0 && 'text-danger']}>{rupiah(m.gross)}</td>
								<td class="num">{rupiah(m.overhead)}</td>
								<td class={['num font-bold', m.net < 0 && 'text-danger']}>{rupiah(m.net)}</td>
								<td class="num">{m.margin === null ? '–' : `${m.margin}%`}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="font-bold">
						<td>Total {pl.year}</td>
						<td class="num">{rupiah(pl.total.income)}</td>
						<td class="num">{rupiah(pl.total.direct)}</td>
						<td class={['num', pl.total.gross < 0 && 'text-danger']}>{rupiah(pl.total.gross)}</td>
						<td class="num">{rupiah(pl.total.overhead)}</td>
						<td class={['num', pl.total.net < 0 && 'text-danger']}>{rupiah(pl.total.net)}</td>
						<td class="num">{pl.total.margin === null ? '–' : `${pl.total.margin}%`}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	</section>

	<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-labelledby="oh-title">
		<h2 id="oh-title" class="text-section-title">Overhead per kategori</h2>
		{#if pl.overheadByCategory.length === 0}
			<p
				class="rounded-control bg-tint-2 px-4 py-4 text-center text-small font-semibold text-ink-2"
			>
				Belum ada biaya overhead di {pl.year}. Catat dengan "+ Transaksi", jenis Pengeluaran,
				kategori Overhead (mis. Gaji, Sewa Kantor).
			</p>
		{:else}
			<ul class="flex flex-col">
				{#each pl.overheadByCategory as o (o.name)}
					<li class="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
						<span class="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
						<span class="text-small text-ink-3">{share(o.amount)}%</span>
						<span class="w-36 text-right font-bold whitespace-nowrap">{rupiah(o.amount)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<TransactionFormDrawer
	bind:this={drawer}
	form={data.form}
	categories={data.categories}
	clients={data.targets.clients}
	projects={data.targets.projects}
	invoices={data.targets.invoices}
/>
