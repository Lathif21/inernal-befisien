<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ban from '@lucide/svelte/icons/ban';
	import Download from '@lucide/svelte/icons/download';
	import Eye from '@lucide/svelte/icons/eye';
	import Send from '@lucide/svelte/icons/send';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Wallet from '@lucide/svelte/icons/wallet';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import InvoiceEditor from '#lib/components/invoices/InvoiceEditor.svelte';
	import InvoiceStatusChip from '#lib/components/invoices/InvoiceStatusChip.svelte';
	import PaymentModal, { type PaymentValue } from '#lib/components/invoices/PaymentModal.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import PaymentProgress from '#lib/components/projects/PaymentProgress.svelte';
	import { PAYMENT_METHOD_LABELS } from '#lib/constants.ts';
	import { dateID, rupiah } from '#lib/format.ts';
	import { PAYABLE_INVOICE_STATUSES } from '#lib/invoice.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const inv = $derived(data.invoice);
	const pay = $derived(data.payments);
	const payable = $derived((PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status));
	let sendOpen = $state(false);
	let voidOpen = $state(false);
	let payOpen = $state(false);
	let removeOpen = $state(false);
	let removing = $state<(typeof data.payments.rows)[number] | null>(null);

	async function savePayment(v: PaymentValue) {
		const body = new FormData();
		for (const [k, val] of Object.entries(v)) body.append(k, val === null ? '' : String(val));
		const res = await fetch('?/pay', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			const fields = result.data?.fields as Record<string, string> | undefined;
			if (fields) return fields;
			toast.error(String(result.data?.error ?? 'Pembayaran gagal disimpan.'));
			return {};
		}
		if (result.type !== 'success') {
			toast.error('Pembayaran gagal disimpan.');
			return {};
		}
		await invalidateAll();
		toast.success(String(result.data?.done ?? 'Pembayaran dicatat.'));
	}
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
			{#if payable || inv.status === 'draft'}
				<button
					type="button"
					class="bf-btn bf-btn--primary bf-btn--sm"
					disabled={!payable}
					title={payable ? undefined : 'Tandai invoice terkirim dulu'}
					onclick={() => (payOpen = true)}
				>
					<Wallet size={15} strokeWidth={1.9} />
					Catat Pembayaran
				</button>
			{/if}
			{#if inv.status !== 'void' && inv.status !== 'paid' && pay.rows.length === 0}
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
				: pay.rows.length
					? 'Invoice sudah dikirim, jadi isinya tidak bisa diubah lagi. Untuk membatalkannya, hapus dulu pembayarannya.'
					: 'Invoice sudah dikirim, jadi isinya tidak bisa diubah lagi. Jika ada yang salah, batalkan lalu buat invoice baru.'}
		</p>
	{/if}

	{#if inv.status !== 'draft' && (inv.status !== 'void' || pay.rows.length)}
		<section class="flex flex-col gap-4 rounded-card bg-surface p-5" aria-labelledby="pay-title">
			<div class="flex flex-col gap-1">
				<h2 id="pay-title" class="text-section-title">Pembayaran</h2>
				<p class="text-small text-ink-2">
					Lunas jika {rupiah(pay.expected)} sudah diterima{inv.pph23Amount
						? ` (total invoice dikurangi PPh 23 ${rupiah(inv.pph23Amount)} yang dipotong klien)`
						: ''}.
					{#if pay.remaining > 0 && inv.status !== 'void'}Sisa <b class="text-ink"
							>{rupiah(pay.remaining)}</b
						>.{/if}
				</p>
			</div>
			<PaymentProgress paid={pay.paid} contractValue={pay.expected} />
			{#if pay.rows.length === 0}
				<p
					class="rounded-control bg-tint-2 px-4 py-4 text-center text-small font-semibold text-ink-2"
				>
					Belum ada pembayaran.
				</p>
			{:else}
				<ul class="flex flex-col">
					{#each pay.rows as p (p.id)}
						<li class="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
							<div class="min-w-0 flex-1">
								<p class="text-body font-semibold text-ink">
									{rupiah(p.amount)}
									{#if p.status === 'planned'}<span class="bf-chip ml-1">Direncanakan</span>{/if}
								</p>
								<p class="truncate text-small text-ink-2">
									{dateID(p.date)}{p.categoryName ? ` · ${p.categoryName}` : ''}{p.method
										? ` · ${PAYMENT_METHOD_LABELS[p.method]}`
										: ''}{p.reference ? ` · ${p.reference}` : ''}
								</p>
							</div>
							<button
								type="button"
								class="bf-btn bf-btn--ghost bf-btn--sm"
								aria-label="Hapus pembayaran {rupiah(p.amount)} tanggal {dateID(p.date)}"
								onclick={() => {
									removing = p;
									removeOpen = true;
								}}
							>
								<Trash size={15} strokeWidth={1.9} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="text-small text-ink-3">
				Pembayaran juga tercatat sebagai pemasukan di
				<a href={resolve('finance')} class="font-bold text-accent-ink">Keuangan</a>.
			</p>
		</section>
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

<PaymentModal
	bind:open={payOpen}
	invoiceNumber={inv.number}
	remaining={pay.remaining}
	categories={data.categories}
	onsubmit={savePayment}
/>

<ConfirmDialog
	bind:open={removeOpen}
	title="Hapus pembayaran?"
	action="?/deletePayment"
	fields={{ id: removing?.id ?? '' }}
	confirmLabel="Hapus"
	tone="danger"
>
	Pembayaran {removing ? rupiah(removing.amount) : ''} dihapus dari invoice dan dari Keuangan. Status
	invoice dihitung ulang.
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
