<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Pager from '#lib/components/Pager.svelte';
	import PeriodFilter from '#lib/components/PeriodFilter.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import FinanceTabs from '#lib/components/finance/FinanceTabs.svelte';
	import TransactionFormDrawer from '#lib/components/finance/TransactionFormDrawer.svelte';
	import TransactionTable from '#lib/components/finance/TransactionTable.svelte';
	import Money from '#lib/components/money/Money.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { TXN_STATUS_LABELS, TXN_STATUSES } from '#lib/constants.ts';
	import { rupiahShort } from '#lib/format.ts';
	import { delta } from '#lib/finance.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ---------- URL (filters, period and the table page live in the query string) ----------
	function href(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), page: undefined, ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`finance?${qs}`) : resolve('finance');
	}
	const go = (changes: Record<string, string | undefined>) =>
		goto(href(changes), { replace: true, reset: false });

	let q = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	const hasFilters = $derived(
		Boolean(
			data.params.q ||
			data.params.type ||
			data.params.status ||
			data.params.category ||
			data.params.client
		)
	);

	const t = $derived(data.totals);
	const prev = $derived(data.previous);
	const categoryOptions = $derived(
		data.categories.filter((c) => !data.params.type || c.type === data.params.type)
	);

	let drawer: ReturnType<typeof TransactionFormDrawer> | undefined = $state();
</script>

<Topbar title="Keuangan">
	{#snippet filters()}
		<PeriodFilter value={data.period} {href} />
	{/snippet}
	{#snippet actions()}
		<button
			type="button"
			class="bf-btn bf-btn--primary"
			onclick={() => drawer?.openCreate({ clientId: data.params.client })}
		>
			<Plus size={18} strokeWidth={2} />
			Transaksi
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	<FinanceTabs current="transaksi" />

	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Ringkasan periode">
		<StatTile
			label="Pemasukan"
			value={rupiahShort(t.income)}
			delta={delta(t.income, prev.income, true)}
			note="Belum ada data periode sebelumnya"
		/>
		<StatTile
			label="Pengeluaran"
			value={rupiahShort(t.expense)}
			delta={delta(t.expense, prev.expense, false)}
			note="Belum ada data periode sebelumnya"
		/>
		<StatTile
			label="Laba"
			value={rupiahShort(t.profit)}
			variant="dark"
			delta={delta(t.profit, prev.profit, true)}
			note={t.margin !== null ? `Margin ${t.margin}%` : 'Belum ada pemasukan'}
		/>
		<StatTile
			label="Pemasukan direncanakan"
			value={rupiahShort(t.plannedIncome)}
			variant="planned"
			note="{t.plannedCount} transaksi direncanakan"
		/>
	</section>

	<section class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5" aria-label="Transaksi">
		<form
			method="get"
			role="search"
			class="flex flex-wrap items-center gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				go({ q: q || undefined });
			}}
		>
			<label class="bf-search min-w-0 flex-[1_1_240px]">
				<Search size={16} strokeWidth={2} aria-hidden="true" />
				<input
					type="search"
					name="q"
					bind:value={q}
					oninput={() => {
						clearTimeout(qTimer);
						qTimer = setTimeout(() => go({ q: q || undefined }), 300);
					}}
					placeholder="Cari keterangan, kategori, klien"
					aria-label="Cari transaksi"
					maxlength="100"
				/>
			</label>
			<nav class="bf-seg" aria-label="Jenis transaksi">
				{#each [{ v: undefined, label: 'Semua' }, { v: 'income', label: 'Masuk' }, { v: 'expense', label: 'Keluar' }] as o (o.label)}
					<a
						href={href({ type: o.v, category: undefined })}
						aria-current={data.params.type === o.v ? 'page' : undefined}
						data-sveltekit-replacestate
						data-sveltekit-noscroll>{o.label}</a
					>
				{/each}
			</nav>
			<label class="sr-only" for="filter-category">Kategori</label>
			<select
				id="filter-category"
				class="min-h-10 rounded-control border border-line bg-surface px-3 text-small font-semibold"
				value={data.params.category ?? ''}
				onchange={(e) => go({ category: e.currentTarget.value || undefined })}
			>
				<option value="">Semua kategori</option>
				{#each categoryOptions as c (c.id)}
					<option value={c.id}>{c.name} ({c.type === 'income' ? 'masuk' : 'keluar'})</option>
				{/each}
			</select>
			<label class="sr-only" for="filter-client">Klien</label>
			<select
				id="filter-client"
				class="min-h-10 max-w-60 rounded-control border border-line bg-surface px-3 text-small font-semibold"
				value={data.params.client ?? ''}
				onchange={(e) => go({ client: e.currentTarget.value || undefined })}
			>
				<option value="">Semua klien</option>
				{#each data.targets.clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			<label class="sr-only" for="filter-status">Status</label>
			<select
				id="filter-status"
				class="min-h-10 rounded-control border border-line bg-surface px-3 text-small font-semibold"
				value={data.params.status ?? ''}
				onchange={(e) => go({ status: e.currentTarget.value || undefined })}
			>
				<option value="">Semua status</option>
				{#each TXN_STATUSES as s (s)}<option value={s}>{TXN_STATUS_LABELS[s]}</option>{/each}
			</select>
			{#if hasFilters}
				<a
					href={href({
						q: undefined,
						type: undefined,
						status: undefined,
						category: undefined,
						client: undefined
					})}
					class="text-small font-bold text-accent-ink"
					onclick={() => (q = '')}
					data-sveltekit-replacestate>Hapus filter</a
				>
			{/if}
		</form>

		<p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-2" aria-live="polite">
			<span
				>Menampilkan <b class="text-ink">{data.list.total}</b> dari {data.list.all} transaksi</span
			>
			{#if data.list.total > 0}
				<span
					>Dibayar: <Money amount={data.list.paidIncome} type="income" /> · <Money
						amount={data.list.paidExpense}
						type="expense"
					/></span
				>
			{/if}
		</p>

		<TransactionTable
			rows={data.list.rows}
			showClient
			onedit={(row) => drawer?.openEdit(row)}
			ondelete={(row) => drawer?.openDelete(row)}
			empty={data.list.all === 0
				? 'Belum ada transaksi. Catat dengan tombol "+ Transaksi".'
				: 'Tidak ada transaksi yang cocok dengan filter.'}
		/>

		{#if data.list.total > data.list.pageSize}
			<Pager
				page={data.list.page}
				total={data.list.total}
				pageSize={data.list.pageSize}
				noun="transaksi"
				href={(n) => href({ page: n > 1 ? String(n) : undefined })}
			/>
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
