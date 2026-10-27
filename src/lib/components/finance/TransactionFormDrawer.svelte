<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
	import Trash from '@lucide/svelte/icons/trash-2';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import {
		PAYMENT_METHOD_LABELS,
		PAYMENT_METHODS,
		TXN_STATUS_LABELS,
		TXN_TYPE_LABELS,
		TXN_TYPES,
		type PaymentMethod,
		type TxnStatus,
		type TxnType
	} from '#lib/constants.ts';
	import { dayKeyWib, rupiah } from '#lib/format.ts';
	import { PAYABLE_INVOICE_STATUSES } from '#lib/invoice.ts';
	import type { FormMessage } from '#lib/schemas/message.ts';
	import type { TxnInvoice } from '#lib/server/services/transactions.ts';
	import { FORM_TXN_STATUSES, type TransactionInput } from '#lib/schemas/transaction.ts';
	import { toast } from '#lib/toast.ts';

	export type EditableTransaction = {
		id: string;
		type: TxnType;
		status: TxnStatus;
		date: string;
		amount: number;
		/** null for overhead costs */
		clientId: string | null;
		projectId: string | null;
		/** The invoice this income pays (P2-07) */
		invoiceId?: string | null;
		invoiceNumber?: string | null;
		categoryId: string | null;
		method: PaymentMethod | null;
		description: string | null;
		reference: string | null;
	};

	type Props = {
		form: SuperValidated<TransactionInput, FormMessage>;
		categories: { id: string; type: TxnType; name: string; isOverhead?: boolean }[];
		clients: { id: string; name: string; archived: boolean }[];
		projects: { id: string; name: string; clientId: string }[];
		/** Sent invoices an income row can pay (listTxnInvoices) */
		invoices?: TxnInvoice[];
		/** On a client page the client is fixed */
		lockClient?: boolean;
	};

	let {
		form: initial,
		categories,
		clients,
		projects,
		invoices = [],
		lockClient = false
	}: Props = $props();

	let open = $state(false);
	let editing = $state<EditableTransaction | null>(null);
	let deleteOpen = $state(false);

	const { form, errors, enhance, submitting, message, reset } = superForm(
		untrack(() => initial),
		{
			id: 'transaction-form',
			dataType: 'form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					open = false;
					toast.success(form.message.text);
				}
			}
		}
	);

	export function openCreate(
		prefill: { type?: TxnType; clientId?: string; projectId?: string } = {}
	) {
		editing = null;
		reset({
			data: {
				type: prefill.type ?? 'income',
				status: 'paid',
				date: dayKeyWib(),
				clientId: prefill.clientId ?? '',
				projectId: prefill.projectId ?? ''
			}
		});
		open = true;
	}

	export function openEdit(t: EditableTransaction) {
		editing = t;
		reset({
			data: {
				id: t.id,
				type: t.type,
				status: t.status === 'cancelled' ? 'planned' : t.status,
				date: t.date,
				amount: t.amount,
				clientId: t.clientId ?? '',
				projectId: t.projectId ?? '',
				invoiceId: t.invoiceId ?? '',
				categoryId: t.categoryId ?? '',
				method: t.method ?? '',
				description: t.description ?? '',
				reference: t.reference ?? ''
			}
		});
		open = true;
	}

	/** The table's delete button: the same confirm as "Hapus" in the drawer, without the drawer */
	export function openDelete(t: EditableTransaction) {
		editing = t;
		deleteOpen = true;
	}

	// A client page has a fixed client, so overhead (no client, P2-08) is not offered there
	const typeCategories = $derived(
		categories.filter((c) => c.type === $form.type && !(lockClient && c.isOverhead))
	);
	const projectCategories = $derived(typeCategories.filter((c) => !c.isOverhead));
	const overheadCategories = $derived(typeCategories.filter((c) => c.isOverhead));
	const overhead = $derived(categories.find((c) => c.id === $form.categoryId)?.isOverhead === true);
	const clientProjects = $derived(projects.filter((p) => p.clientId === $form.clientId));
	// New transactions only go to active clients; an edit keeps its (maybe archived) client
	const clientOptions = $derived(clients.filter((c) => !c.archived || c.id === editing?.clientId));
	const clientName = $derived(clients.find((c) => c.id === $form.clientId)?.name ?? '');
	// Income from a client can pay one of its invoices; the one it already pays stays listed
	const canLink = $derived($form.type === 'income' && !overhead && !!$form.clientId);
	const clientInvoices = $derived(
		invoices.filter(
			(i) =>
				i.clientId === $form.clientId &&
				((PAYABLE_INVOICE_STATUSES as readonly string[]).includes(i.status) ||
					i.id === editing?.invoiceId)
		)
	);
	const invoiceLabel = (i: TxnInvoice) => {
		const left = i.total - i.pph23Amount - i.paid;
		return `${i.number} · ${left > 0 ? `sisa ${rupiah(left)}` : 'lunas'}`;
	};

	function setType(t: TxnType) {
		if ($form.type === t) return;
		$form.type = t;
		// categories belong to one direction; only income pays an invoice
		$form.categoryId = '';
		$form.invoiceId = '';
	}
	function setClient(id: string) {
		$form.clientId = id;
		if (!projects.some((p) => p.id === $form.projectId && p.clientId === id)) $form.projectId = '';
		if (!invoices.some((i) => i.id === $form.invoiceId && i.clientId === id)) $form.invoiceId = '';
	}
	function setInvoice(id: string) {
		$form.invoiceId = id;
		// a payment usually belongs to the invoice's project
		const project = invoices.find((i) => i.id === id)?.projectId;
		if (project && !$form.projectId) $form.projectId = project;
	}
</script>

<Drawer
	bind:open
	title={editing ? 'Edit transaksi' : 'Catat transaksi'}
	description={editing
		? `${TXN_TYPE_LABELS[editing.type].long} ${rupiah(editing.amount)}`
		: lockClient
			? clientName
			: 'Pemasukan, pengeluaran proyek, atau biaya overhead.'}
>
	<form
		id="transaction-form"
		method="post"
		action="?/saveTransaction"
		use:enhance
		class="flex flex-col gap-4"
		novalidate
	>
		<input type="hidden" name="id" bind:value={$form.id} />
		<input type="hidden" name="type" value={$form.type} />
		<input type="hidden" name="status" value={$form.status} />

		{#if $message?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$message.text}
			</p>
		{/if}

		<div class="flex flex-col gap-1.5">
			<span class="text-small font-bold text-ink-2" id="txn-type-label">Jenis</span>
			<div class="bf-seg w-fit" role="group" aria-labelledby="txn-type-label">
				{#each TXN_TYPES as t (t)}
					<button type="button" aria-pressed={$form.type === t} onclick={() => setType(t)}
						>{TXN_TYPE_LABELS[t].long}</button
					>
				{/each}
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Jumlah" name="amount" required errors={$errors.amount}>
				{#snippet children(attrs)}
					<MoneyInput
						id={attrs.id}
						name="amount"
						bind:value={$form.amount}
						aria-invalid={attrs['aria-invalid']}
						aria-describedby={attrs['aria-describedby']}
					/>
				{/snippet}
			</Field>
			<Field
				label="Tanggal"
				name="date"
				required
				errors={$errors.date}
				hint={$form.status === 'planned' ? 'Perkiraan tanggal bayar' : 'Tanggal dibayar'}
			>
				{#snippet children(attrs)}
					<input {...attrs} type="date" bind:value={$form.date} />
				{/snippet}
			</Field>
		</div>

		<div class="flex flex-col gap-1.5">
			<span class="text-small font-bold text-ink-2" id="txn-status-label">Status</span>
			<div class="bf-seg bf-seg--dark w-fit" role="group" aria-labelledby="txn-status-label">
				{#each FORM_TXN_STATUSES as s (s)}
					<button type="button" aria-pressed={$form.status === s} onclick={() => ($form.status = s)}
						>{TXN_STATUS_LABELS[s]}</button
					>
				{/each}
			</div>
		</div>

		<Field label="Kategori" name="categoryId" required errors={$errors.categoryId}>
			{#snippet children(attrs)}
				<select {...attrs} bind:value={$form.categoryId}>
					<option value="">Pilih kategori</option>
					{#if overheadCategories.length}
						<optgroup label="Biaya proyek">
							{#each projectCategories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</optgroup>
						<optgroup label="Overhead (tanpa klien)">
							{#each overheadCategories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</optgroup>
					{:else}
						{#each typeCategories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					{/if}
				</select>
			{/snippet}
		</Field>

		{#if overhead}
			<p class="rounded-control bg-tint-2 px-3.5 py-2.5 text-small font-semibold text-ink-2">
				Biaya overhead tidak terkait klien atau proyek. Masuk ke Laba Rugi sebagai overhead.
			</p>
		{:else}
			<Field label="Klien" name="clientId" required errors={$errors.clientId}>
				{#snippet children(attrs)}
					{#if lockClient}
						<input type="hidden" name="clientId" value={$form.clientId} />
						<input id={attrs.id} value={clientName} readonly class="bg-tint-2!" />
					{:else}
						<select
							{...attrs}
							value={$form.clientId}
							onchange={(e) => setClient(e.currentTarget.value)}
						>
							<option value="">Pilih klien</option>
							{#each clientOptions as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</select>
					{/if}
				{/snippet}
			</Field>
		{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			{#if !overhead}
				<Field
					label="Proyek"
					name="projectId"
					errors={$errors.projectId}
					hint={$form.clientId && clientProjects.length === 0 ? 'Klien ini belum punya proyek' : ''}
				>
					{#snippet children(attrs)}
						<select {...attrs} bind:value={$form.projectId} disabled={!$form.clientId}>
							<option value="">Tanpa proyek</option>
							{#each clientProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
						</select>
					{/snippet}
				</Field>
			{/if}
			<Field label="Metode" name="method" errors={$errors.method}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.method}>
						<option value="">–</option>
						{#each PAYMENT_METHODS as m (m)}<option value={m}>{PAYMENT_METHOD_LABELS[m]}</option
							>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Referensi" name="reference" errors={$errors.reference} hint="No. bukti / bank">
				{#snippet children(attrs)}
					<input {...attrs} bind:value={$form.reference} maxlength="100" />
				{/snippet}
			</Field>
		</div>

		{#if canLink && (clientInvoices.length || $form.invoiceId)}
			<Field
				label="Invoice"
				name="invoiceId"
				errors={$errors.invoiceId}
				hint={$form.invoiceId
					? 'Dihitung sebagai pembayaran invoice ini; status invoice ikut berubah.'
					: 'Pilih jika pemasukan ini pembayaran invoice, agar tidak tercatat dua kali.'}
			>
				{#snippet children(attrs)}
					<select
						{...attrs}
						value={$form.invoiceId}
						onchange={(e) => setInvoice(e.currentTarget.value)}
					>
						<option value="">Tanpa invoice</option>
						{#each clientInvoices as i (i.id)}<option value={i.id}>{invoiceLabel(i)}</option>{/each}
						<!-- keep the current link selectable even when the list does not carry it -->
						{#if editing?.invoiceId && editing.invoiceId === $form.invoiceId && !clientInvoices.some((i) => i.id === editing?.invoiceId)}
							<option value={editing.invoiceId}
								>{editing.invoiceNumber ?? 'Invoice saat ini'}</option
							>
						{/if}
					</select>
				{/snippet}
			</Field>
		{/if}

		<Field label="Keterangan" name="description" errors={$errors.description}>
			{#snippet children(attrs)}
				<textarea
					{...attrs}
					bind:value={$form.description}
					rows="2"
					maxlength="500"
					placeholder="DP 30% integrasi SCADA"></textarea>
			{/snippet}
		</Field>
	</form>

	{#snippet footer()}
		{#if editing}
			<button
				type="button"
				class="bf-btn bf-btn--ghost mr-auto text-danger!"
				onclick={() => (deleteOpen = true)}
			>
				<Trash size={16} strokeWidth={1.75} />
				Hapus
			</button>
		{/if}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button
			type="submit"
			form="transaction-form"
			class="bf-btn bf-btn--primary"
			disabled={$submitting}
		>
			{$submitting ? 'Menyimpan…' : 'Simpan transaksi'}
		</button>
	{/snippet}
</Drawer>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Hapus transaksi?"
	action="?/deleteTransaction"
	fields={{ id: editing?.id ?? '' }}
	confirmLabel="Hapus transaksi"
	tone="danger"
	onsuccess={() => (open = false)}
>
	{#if editing}
		<b class="text-ink">{TXN_TYPE_LABELS[editing.type].long} {rupiah(editing.amount)}</b>
		{editing.description ? `(${editing.description})` : ''} dihapus. Total klien dihitung ulang.
	{/if}
</ConfirmDialog>
