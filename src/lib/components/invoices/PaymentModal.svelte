<script lang="ts">
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, TXN_STATUS_LABELS } from '#lib/constants.ts';
	import { dateID, dayKeyWib, rupiah } from '#lib/format.ts';
	import type { LinkableTransaction } from '#lib/server/services/invoice-payments.ts';

	export type PaymentValue = {
		/** An income row already in Keuangan; '' = record a new one */
		transactionId: string;
		date: string;
		amount: number | null;
		categoryId: string;
		method: string;
		reference: string;
		description: string;
	};

	type Props = {
		open: boolean;
		invoiceNumber: string;
		/** Cash still expected (total − PPh 23 − paid); the default amount */
		remaining: number;
		categories: { id: string; name: string }[];
		/** Unlinked income rows of the invoice's client, offered so a payment is not recorded twice */
		linkable: LinkableTransaction[];
		/** Save; resolves to field errors, or nothing when saved */
		onsubmit: (value: PaymentValue) => Promise<Record<string, string> | void>;
	};

	let {
		open = $bindable(),
		invoiceNumber,
		remaining,
		categories,
		linkable,
		onsubmit
	}: Props = $props();

	const defaultCategory = () =>
		(categories.find((c) => c.name === 'Termin') ?? categories[0])?.id ?? '';
	const fresh = (): PaymentValue => ({
		transactionId: '',
		date: dayKeyWib(),
		amount: remaining || null,
		categoryId: defaultCategory(),
		method: 'transfer',
		reference: '',
		description: ''
	});
	let value = $state<PaymentValue>(fresh());
	let errors = $state<Record<string, string>>({});
	let busy = $state(false);
	/** "Dari Keuangan" links an existing row; "Catat baru" writes a new one */
	let mode = $state<'link' | 'new'>('new');
	const picked = $derived(linkable.find((t) => t.id === value.transactionId));

	$effect(() => {
		if (open) {
			value = fresh();
			errors = {};
			busy = false;
			mode = linkable.length ? 'link' : 'new';
		}
	});

	function setMode(m: 'link' | 'new') {
		mode = m;
		value = fresh();
		errors = {};
	}

	/** Fill the form from the chosen row; a planned row is paid today unless changed */
	function pick(id: string) {
		const t = linkable.find((r) => r.id === id);
		errors = {};
		if (!t) {
			value = fresh();
			return;
		}
		value = {
			transactionId: t.id,
			date: t.status === 'paid' ? t.date : dayKeyWib(),
			amount: t.amount,
			categoryId: t.categoryId ?? defaultCategory(),
			method: t.method ?? 'transfer',
			reference: t.reference ?? '',
			description: t.description ?? ''
		};
	}

	const label = (t: LinkableTransaction) =>
		[
			dateID(t.date),
			rupiah(t.amount),
			TXN_STATUS_LABELS[t.status],
			t.description || t.categoryName,
			t.projectName
		]
			.filter(Boolean)
			.join(' · ');

	const err = (k: string) => (errors[k] ? [errors[k]] : undefined);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (mode === 'link' && !value.transactionId) {
			errors = { transactionId: 'Pilih transaksi dari daftar.' };
			return;
		}
		busy = true;
		try {
			const result = await onsubmit(value);
			if (result) errors = result;
			else open = false;
		} finally {
			busy = false;
		}
	}
</script>

<!-- "Catat Pembayaran": a paid income transaction linked to the invoice, new or from Keuangan -->
<Modal bind:open title="Catat pembayaran" description={invoiceNumber}>
	<form id="payment-form" novalidate onsubmit={save} class="flex flex-col gap-4">
		{#if linkable.length}
			<div class="flex flex-col gap-1.5">
				<span class="text-small font-bold text-ink-2" id="pay-source-label">Sumber</span>
				<div class="bf-seg w-fit" role="group" aria-labelledby="pay-source-label">
					<button type="button" aria-pressed={mode === 'link'} onclick={() => setMode('link')}
						>Dari Keuangan ({linkable.length})</button
					>
					<button type="button" aria-pressed={mode === 'new'} onclick={() => setMode('new')}
						>Catat baru</button
					>
				</div>
			</div>
		{/if}

		{#if mode === 'link'}
			<Field
				label="Transaksi di Keuangan"
				name="pay-transaction"
				required
				errors={err('transactionId')}
				hint={picked?.status === 'planned'
					? 'Statusnya berubah dari Direncanakan menjadi Sudah dibayar.'
					: 'Pemasukan klien ini yang belum terhubung ke invoice. Dipakai sebagai pembayaran, jadi tidak tercatat dua kali.'}
			>
				{#snippet children(attrs)}
					<select
						{...attrs}
						value={value.transactionId}
						onchange={(e) => pick(e.currentTarget.value)}
					>
						<option value="">Pilih transaksi</option>
						{#each linkable as t (t.id)}<option value={t.id}>{label(t)}</option>{/each}
					</select>
				{/snippet}
			</Field>
		{/if}

		{#if mode === 'new' || value.transactionId}
			<div class="grid gap-4 *:min-w-0 sm:grid-cols-2">
				<Field
					label="Jumlah diterima"
					name="pay-amount"
					required
					errors={err('amount')}
					hint={remaining ? `Sisa ${rupiah(remaining)}` : undefined}
				>
					{#snippet children(attrs)}
						<MoneyInput
							id={attrs.id}
							name="pay-amount-value"
							bind:value={value.amount}
							aria-invalid={attrs['aria-invalid']}
							aria-describedby={attrs['aria-describedby']}
						/>
					{/snippet}
				</Field>
				<Field label="Tanggal" name="pay-date" required errors={err('date')}>
					{#snippet children(attrs)}
						<input {...attrs} type="date" bind:value={value.date} />
					{/snippet}
				</Field>
				<Field label="Kategori" name="pay-category" required errors={err('categoryId')}>
					{#snippet children(attrs)}
						<select {...attrs} bind:value={value.categoryId}>
							<option value="">Pilih kategori</option>
							{#each categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</select>
					{/snippet}
				</Field>
				<Field label="Metode" name="pay-method" errors={err('method')}>
					{#snippet children(attrs)}
						<select {...attrs} bind:value={value.method}>
							{#each PAYMENT_METHODS as m (m)}<option value={m}>{PAYMENT_METHOD_LABELS[m]}</option
								>{/each}
						</select>
					{/snippet}
				</Field>
			</div>
			<Field
				label="Referensi"
				name="pay-reference"
				errors={err('reference')}
				hint="No. bukti transfer / bank"
			>
				{#snippet children(attrs)}
					<input {...attrs} bind:value={value.reference} maxlength="100" />
				{/snippet}
			</Field>
			<Field
				label="Keterangan"
				name="pay-description"
				errors={err('description')}
				hint="Kosongkan untuk “Pembayaran {invoiceNumber}”"
			>
				{#snippet children(attrs)}
					<input {...attrs} bind:value={value.description} maxlength="500" />
				{/snippet}
			</Field>
		{/if}
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form="payment-form" class="bf-btn bf-btn--primary" disabled={busy}>
			{busy ? 'Menyimpan…' : mode === 'link' ? 'Hubungkan pembayaran' : 'Simpan pembayaran'}
		</button>
	{/snippet}
</Modal>
