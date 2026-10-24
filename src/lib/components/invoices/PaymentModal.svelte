<script lang="ts">
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '#lib/constants.ts';
	import { dayKeyWib, rupiah } from '#lib/format.ts';

	export type PaymentValue = {
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
		/** Save; resolves to field errors, or nothing when saved */
		onsubmit: (value: PaymentValue) => Promise<Record<string, string> | void>;
	};

	let { open = $bindable(), invoiceNumber, remaining, categories, onsubmit }: Props = $props();

	const fresh = (): PaymentValue => ({
		date: dayKeyWib(),
		amount: remaining || null,
		categoryId: (categories.find((c) => c.name === 'Termin') ?? categories[0])?.id ?? '',
		method: 'transfer',
		reference: '',
		description: ''
	});
	let value = $state<PaymentValue>(fresh());
	let errors = $state<Record<string, string>>({});
	let busy = $state(false);

	$effect(() => {
		if (open) {
			value = fresh();
			errors = {};
			busy = false;
		}
	});

	const err = (k: string) => (errors[k] ? [errors[k]] : undefined);

	async function save(e: SubmitEvent) {
		e.preventDefault();
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

<!-- "Catat Pembayaran": a paid income transaction linked to the invoice -->
<Modal bind:open title="Catat pembayaran" description={invoiceNumber}>
	<form id="payment-form" novalidate onsubmit={save} class="flex flex-col gap-4">
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
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form="payment-form" class="bf-btn bf-btn--primary" disabled={busy}>
			{busy ? 'Menyimpan…' : 'Simpan pembayaran'}
		</button>
	{/snippet}
</Modal>
