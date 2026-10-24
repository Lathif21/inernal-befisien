<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ban from '@lucide/svelte/icons/ban';
	import Download from '@lucide/svelte/icons/download';
	import Eye from '@lucide/svelte/icons/eye';
	import Send from '@lucide/svelte/icons/send';
	import Wallet from '@lucide/svelte/icons/wallet';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import InvoiceEditor from '#lib/components/invoices/InvoiceEditor.svelte';
	import InvoiceStatusChip from '#lib/components/invoices/InvoiceStatusChip.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { dateID, rupiah } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const inv = $derived(data.invoice);
	let sendOpen = $state(false);
	let voidOpen = $state(false);
</script>

<Topbar title={inv.number}>
	{#snippet actions()}
		{#if inv.status === 'draft'}
			<button type="button" class="bf-btn bf-btn--primary" onclick={() => (sendOpen = true)}>
				<Send size={16} strokeWidth={1.9} />
				Tandai Terkirim
			</button>
		{/if}
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	<a
		href={resolve('invoices')}
		class="inline-flex min-h-(--size-touch) w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Semua invoice
	</a>

	<section
		class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card bg-surface px-5 py-4"
		aria-label="Status invoice"
	>
		<InvoiceStatusChip status={inv.status} />
		<span class="min-w-0 flex-1 text-small text-ink-2">
			<a
				href={resolve('/(app)/clients/[id]', { id: inv.clientId })}
				class="font-bold text-ink hover:text-accent-ink">{inv.client.name}</a
			>
			{#if inv.projectName}· {inv.projectName}{/if}
			· total <b class="text-ink">{rupiah(inv.total)}</b>
			{#if inv.sentAt}· dikirim {dateID(inv.sentAt)}{/if}
		</span>
		<div class="flex flex-wrap gap-2">
			<a
				href={resolve('/(app)/invoices/[id]/pdf?view', { id: inv.id })}
				target="_blank"
				rel="noopener"
				class="bf-btn bf-btn--ghost bf-btn--sm"
				title="PDF memakai data yang sudah disimpan"
			>
				<Eye size={15} strokeWidth={1.9} />
				Lihat PDF
			</a>
			<a
				href={resolve('/(app)/invoices/[id]/pdf', { id: inv.id })}
				download
				class="bf-btn bf-btn--secondary bf-btn--sm"
				title="PDF memakai data yang sudah disimpan"
			>
				<Download size={15} strokeWidth={1.9} />
				Unduh PDF
			</a>
			<!-- P2-07 -->
			<button
				type="button"
				class="bf-btn bf-btn--secondary bf-btn--sm"
				disabled
				title="Pencatatan pembayaran hadir di P2-07"
			>
				<Wallet size={15} strokeWidth={1.9} />
				Catat Pembayaran
			</button>
			{#if inv.status !== 'void' && inv.status !== 'paid'}
				<button
					type="button"
					class="bf-btn bf-btn--ghost bf-btn--sm text-danger!"
					onclick={() => (voidOpen = true)}
				>
					<Ban size={15} strokeWidth={1.9} />
					Batalkan invoice
				</button>
			{/if}
		</div>
	</section>

	{#if data.companyIsExample}
		<p class="rounded-control bg-warning-bg px-4 py-3 text-small font-semibold text-ink">
			Data perusahaan di PDF (NPWP, rekening bank, penanda tangan) masih contoh.
			<a href={resolve('settings/company')} class="font-bold text-accent-ink"
				>Lengkapi di Pengaturan → Profil perusahaan</a
			>
		</p>
	{/if}

	{#if inv.status !== 'draft'}
		<p class="rounded-control bg-tint px-4 py-3 text-small font-semibold text-ink-2">
			{inv.status === 'void'
				? 'Invoice ini dibatalkan. Nomornya tetap tercatat dan tidak dipakai ulang.'
				: 'Invoice sudah dikirim, jadi isinya tidak bisa diubah lagi. Jika ada yang salah, batalkan lalu buat invoice baru.'}
		</p>
	{/if}

	{#key inv.updatedAt}
		<InvoiceEditor
			form={data.form}
			clients={data.targets.clients}
			projects={data.targets.projects}
			editable={inv.status === 'draft'}
		/>
	{/key}
</main>

<ConfirmDialog
	bind:open={sendOpen}
	title="Tandai invoice terkirim?"
	action="?/send"
	fields={{}}
	confirmLabel="Tandai Terkirim"
>
	<b class="text-ink">{inv.number}</b> ({rupiah(inv.total)}) ditandai terkirim ke {inv.client.name}.
	Setelah ini isinya tidak bisa diubah. Simpan dulu perubahan yang belum disimpan.
</ConfirmDialog>

<ConfirmDialog
	bind:open={voidOpen}
	title="Batalkan invoice?"
	action="?/void"
	fields={{}}
	confirmLabel="Batalkan invoice"
	tone="danger"
>
	<b class="text-ink">{inv.number}</b> dibatalkan dan tidak bisa dipakai lagi. Nomornya tetap tercatat.
</ConfirmDialog>
