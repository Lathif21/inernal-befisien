<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import InvoiceStatusChip from '#lib/components/invoices/InvoiceStatusChip.svelte';
	import { INVOICE_STATUS_LABELS, INVOICE_STATUSES } from '#lib/constants.ts';
	import { dateID, rupiah } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function href(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), page: undefined, ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`invoices?${qs}`) : resolve('invoices');
	}

	let q = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	const all = $derived(Object.values(data.list.counts).reduce((s, n) => s + (n ?? 0), 0));
</script>

<Topbar title="Invoice">
	{#snippet actions()}
		<a href={resolve('invoices/new')} class="bf-btn bf-btn--primary">
			<Plus size={18} strokeWidth={2} />
			Invoice
		</a>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	{#if all === 0 && !data.params.q}
		<EmptyState
			illustration="integration"
			message="Belum ada invoice. Buat invoice pertama dengan PPN 11% dan PPh 23 untuk klien."
		>
			{#snippet action()}
				<a href={resolve('invoices/new')} class="bf-btn bf-btn--primary">
					<Plus size={18} strokeWidth={2} />
					Buat invoice
				</a>
			{/snippet}
		</EmptyState>
	{:else}
		<section
			class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5"
			aria-label="Daftar invoice"
		>
			<div class="flex flex-wrap items-center gap-3">
				<label class="bf-search min-w-0 flex-[1_1_240px]">
					<Search size={16} strokeWidth={2} aria-hidden="true" />
					<input
						type="search"
						bind:value={q}
						oninput={() => {
							clearTimeout(qTimer);
							qTimer = setTimeout(
								() => goto(href({ q: q || undefined }), { replace: true, reset: false }),
								300
							);
						}}
						placeholder="Cari nomor invoice atau klien"
						aria-label="Cari invoice"
						maxlength="100"
					/>
				</label>
			</div>
			<nav class="flex flex-wrap gap-2" aria-label="Status invoice">
				<a
					href={href({ status: undefined })}
					class={['bf-chip px-3! py-1.5!', !data.params.status && 'bg-navy! text-on-accent!']}
					aria-current={!data.params.status ? 'page' : undefined}
					data-sveltekit-replacestate
					data-sveltekit-noscroll>Semua · {all}</a
				>
				{#each INVOICE_STATUSES as s (s)}
					{#if data.list.counts[s]}
						<a
							href={href({ status: s })}
							class={[
								'bf-chip px-3! py-1.5!',
								data.params.status === s && 'bg-navy! text-on-accent!'
							]}
							aria-current={data.params.status === s ? 'page' : undefined}
							data-sveltekit-replacestate
							data-sveltekit-noscroll>{INVOICE_STATUS_LABELS[s]} · {data.list.counts[s]}</a
						>
					{/if}
				{/each}
			</nav>

			{#if data.list.rows.length === 0}
				<p
					class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2"
				>
					Tidak ada invoice yang cocok dengan filter.
				</p>
			{:else}
				<div class="bf-table-wrap min-w-0">
					<table class="bf-table min-w-200">
						<thead>
							<tr>
								<th scope="col">Nomor</th>
								<th scope="col">Klien</th>
								<th scope="col">Tanggal</th>
								<th scope="col">Jatuh tempo</th>
								<th scope="col">Status</th>
								<th scope="col" class="num">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each data.list.rows as inv (inv.id)}
								<tr>
									<td>
										<a
											href={resolve('/(app)/invoices/[id]', { id: inv.id })}
											class="font-mono text-[13px] font-bold text-accent-ink">{inv.number}</a
										>
									</td>
									<td>
										<span class="font-semibold">{inv.clientName}</span>
										{#if inv.projectName}<span class="block text-small text-ink-3"
												>{inv.projectName}</span
											>{/if}
									</td>
									<td class="whitespace-nowrap">{dateID(inv.issueDate)}</td>
									<td class="whitespace-nowrap">{dateID(inv.dueDate)}</td>
									<td>
										<InvoiceStatusChip status={inv.status} />
										{#if inv.status === 'partial'}<span class="block text-small text-ink-3"
												>sisa {rupiah(Math.max(0, inv.total - inv.pph23Amount - inv.paid))}</span
											>{/if}
									</td>
									<td class="num font-bold">{rupiah(inv.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if data.list.total > data.list.pageSize}
					<Pager
						page={data.list.page}
						total={data.list.total}
						pageSize={data.list.pageSize}
						noun="invoice"
						href={(n) => href({ page: n > 1 ? String(n) : undefined })}
					/>
				{/if}
			{/if}
		</section>
	{/if}
</main>
