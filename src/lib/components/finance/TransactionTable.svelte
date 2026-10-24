<script lang="ts">
	import { resolve } from '$app/paths';
	import Money from '#lib/components/money/Money.svelte';
	import { TXN_STATUS_LABELS } from '#lib/constants.ts';
	import { dateID } from '#lib/format.ts';
	import type { TransactionRow } from '#lib/server/services/transactions.ts';

	type Props = {
		rows: TransactionRow[];
		/** Keuangan lists every client; the client page does not repeat its own name */
		showClient?: boolean;
		/** Opens the edit drawer; omitted = read only */
		onedit?: (row: TransactionRow) => void;
		/** Shown when no row matches */
		empty?: string;
	};

	let {
		rows,
		showClient = false,
		onedit,
		empty = 'Tidak ada transaksi yang cocok dengan filter.'
	}: Props = $props();
</script>

<!-- DataTable (docs/design-system/components/DataTable): Tanggal · Keterangan · Kategori · Status · Jumlah -->
{#if rows.length === 0}
	<p class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2">
		{empty}
	</p>
{:else}
	<div class="bf-table-wrap min-w-0">
		<table class={['bf-table', showClient ? 'min-w-200' : 'min-w-160']}>
			<thead>
				<tr>
					<th scope="col">Tanggal</th>
					<th scope="col">Keterangan</th>
					<th scope="col">Kategori</th>
					{#if showClient}<th scope="col">Klien</th>{/if}
					<th scope="col">Status</th>
					<th scope="col" class="num">Jumlah</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as t (t.id)}
					<tr>
						<td class="whitespace-nowrap">{dateID(t.date)}</td>
						<td>
							{#if onedit}
								<button
									type="button"
									class="text-left font-bold hover:text-accent-ink"
									onclick={() => onedit(t)}
									title="Edit transaksi">{t.description ?? '(tanpa keterangan)'}</button
								>
							{:else}<span class="font-bold">{t.description ?? '(tanpa keterangan)'}</span>{/if}
							{#if t.projectName}<span class="block text-small text-ink-3">{t.projectName}</span
								>{/if}
							{#if t.invoiceId && t.invoiceNumber}<a
									href={resolve('/(app)/invoices/[id]', { id: t.invoiceId })}
									class="block font-mono text-[12px] font-bold text-accent-ink"
									title="Pembayaran invoice">{t.invoiceNumber}</a
								>{/if}
						</td>
						<td>{t.categoryName ?? '–'}</td>
						{#if showClient}
							<td>
								<a
									href={resolve(`/(app)/clients/[id]?tab=keuangan`, { id: t.clientId })}
									class="font-semibold text-ink hover:text-accent-ink">{t.clientName}</a
								>
							</td>
						{/if}
						<td>
							<span class={['bf-chip', t.status !== 'paid' && 'bf-chip--planned']}
								>{t.status === 'paid' ? 'Dibayar' : TXN_STATUS_LABELS[t.status]}</span
							>
						</td>
						<td class="num"><Money amount={t.amount} type={t.type} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
