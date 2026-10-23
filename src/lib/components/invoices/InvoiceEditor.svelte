<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import { rupiah } from '#lib/format.ts';
	import { DEFAULT_PPH23_RATE, DEFAULT_PPN_RATE, invoiceTotals } from '#lib/invoice.ts';
	import { addDays } from '#lib/period.ts';
	import type { FormMessage } from '#lib/schemas/message.ts';
	import type { InvoiceInput } from '#lib/schemas/invoice.ts';
	import { toast } from '#lib/toast.ts';

	type Props = {
		form: SuperValidated<InvoiceInput, FormMessage>;
		clients: { id: string; name: string; npwp: string | null }[];
		projects: { id: string; name: string; clientId: string }[];
		/** false once the invoice is sent: everything is shown read-only */
		editable: boolean;
	};

	let { form: initial, clients, projects, editable }: Props = $props();

	const { form, errors, enhance, submitting, message } = superForm(
		untrack(() => initial),
		{
			id: 'invoice-form',
			// items is an array of objects: send JSON (needs JS, like the rest of the editor)
			dataType: 'json',
			resetForm: false,
			onUpdated({ form }) {
				if (form.message?.type === 'success') toast.success(form.message.text);
			}
		}
	);

	const clientProjects = $derived(projects.filter((p) => p.clientId === $form.clientId));
	const client = $derived(clients.find((c) => c.id === $form.clientId));
	const creating = $derived(!$form.id);
	const totals = $derived(
		invoiceTotals(
			$form.items.map((i) => ({ qty: Number(i.qty) || 0, unitPrice: Number(i.unitPrice) || 0 })),
			{ ppnRate: Number($form.ppnRate) || 0, pph23Rate: Number($form.pph23Rate) || 0 }
		)
	);

	/** Errors of one item field (Superforms keeps array errors by index) */
	function itemError(i: number, key: 'description' | 'qty' | 'unitPrice') {
		const list = $errors.items as Record<number, Record<string, string[] | undefined>> | undefined;
		return list?.[i]?.[key];
	}
	const itemsError = $derived(($errors.items as { _errors?: string[] } | undefined)?._errors?.[0]);

	function addItem() {
		$form.items = [...$form.items, { description: '', qty: 1, unitPrice: 0 }];
	}
	function removeItem(i: number) {
		$form.items = $form.items.filter((_, k) => k !== i);
	}
	function moveItem(i: number, d: -1 | 1) {
		const items = [...$form.items];
		[items[i], items[i + d]] = [items[i + d], items[i]];
		$form.items = items;
	}
	function setClient(id: string) {
		$form.clientId = id;
		if (!projects.some((p) => p.id === $form.projectId && p.clientId === id)) $form.projectId = '';
	}
	function setIssueDate(v: string) {
		// keep the same payment term when the issue date moves
		if (v && $form.issueDate && $form.dueDate) {
			const term = (Date.parse($form.dueDate) - Date.parse($form.issueDate)) / 86_400_000;
			$form.dueDate = addDays(v, Math.max(0, term));
		}
		$form.issueDate = v;
	}
</script>

<form
	id="invoice-form"
	method="post"
	action="?/save"
	use:enhance
	novalidate
	class="grid items-start gap-6 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_320px]"
>
	<fieldset disabled={!editable} class="flex min-w-0 flex-col gap-5">
		{#if $message?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$message.text}
			</p>
		{/if}

		<section
			class="grid gap-4 rounded-card bg-surface p-5 sm:grid-cols-2"
			aria-label="Data invoice"
		>
			<Field label="Klien" name="clientId" required errors={$errors.clientId}>
				{#snippet children(attrs)}
					<select
						{...attrs}
						value={$form.clientId}
						onchange={(e) => setClient(e.currentTarget.value)}
						disabled={!creating || !editable}
					>
						<option value="">Pilih klien</option>
						{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					</select>
				{/snippet}
			</Field>
			<Field
				label="Proyek"
				name="projectId"
				errors={$errors.projectId}
				hint={client && !client.npwp ? 'Klien ini belum punya NPWP (isi di data klien)' : ''}
			>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.projectId} disabled={!$form.clientId || !editable}>
						<option value="">Tanpa proyek</option>
						{#each clientProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Tanggal invoice" name="issueDate" required errors={$errors.issueDate}>
				{#snippet children(attrs)}
					<input
						{...attrs}
						type="date"
						value={$form.issueDate}
						onchange={(e) => setIssueDate(e.currentTarget.value)}
					/>
				{/snippet}
			</Field>
			<Field label="Jatuh tempo" name="dueDate" required errors={$errors.dueDate}>
				{#snippet children(attrs)}
					<input {...attrs} type="date" bind:value={$form.dueDate} min={$form.issueDate} />
				{/snippet}
			</Field>
		</section>

		<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-label="Item invoice">
			<h2 class="text-section-title">Item</h2>
			<div
				class="hidden grid-cols-[minmax(0,1fr)_88px_160px_140px_76px] gap-2 text-small font-bold text-ink-2 md:grid"
				aria-hidden="true"
			>
				<span>Uraian</span><span>Qty</span><span>Harga satuan</span><span class="text-right"
					>Jumlah</span
				><span></span>
			</div>
			<ol class="flex flex-col gap-3">
				{#each $form.items as item, i (i)}
					<li
						class="grid grid-cols-2 gap-2 rounded-kanban border border-line p-3 md:grid-cols-[minmax(0,1fr)_88px_160px_140px_76px] md:items-start md:border-0 md:p-0"
					>
						<div class="col-span-2 flex flex-col gap-1 md:col-span-1">
							<label class="sr-only" for="item-{i}-description">Uraian item {i + 1}</label>
							<input
								id="item-{i}-description"
								class="min-h-11 rounded-control border border-line bg-surface px-3 text-body"
								bind:value={item.description}
								maxlength="300"
								placeholder="Pengembangan dashboard produksi"
								aria-invalid={itemError(i, 'description') ? 'true' : undefined}
							/>
							{#if itemError(i, 'description')}<span class="bf-field__error"
									>{itemError(i, 'description')?.[0]}</span
								>{/if}
						</div>
						<div class="flex flex-col gap-1">
							<label class="text-small font-bold text-ink-2 md:sr-only" for="item-{i}-qty"
								>Qty item {i + 1}</label
							>
							<input
								id="item-{i}-qty"
								type="number"
								min="0.01"
								step="0.01"
								inputmode="decimal"
								class="min-h-11 rounded-control border border-line bg-surface px-3 text-body tabular-nums"
								bind:value={item.qty}
								aria-invalid={itemError(i, 'qty') ? 'true' : undefined}
							/>
							{#if itemError(i, 'qty')}<span class="bf-field__error"
									>{itemError(i, 'qty')?.[0]}</span
								>{/if}
						</div>
						<div class="flex flex-col gap-1">
							<label class="text-small font-bold text-ink-2 md:sr-only" for="item-{i}-price"
								>Harga satuan item {i + 1}</label
							>
							<MoneyInput
								id="item-{i}-price"
								name="items.{i}.unitPrice"
								bind:value={item.unitPrice}
								aria-invalid={itemError(i, 'unitPrice') ? 'true' : undefined}
							/>
							{#if itemError(i, 'unitPrice')}<span class="bf-field__error"
									>{itemError(i, 'unitPrice')?.[0]}</span
								>{/if}
						</div>
						<p class="col-span-2 self-center text-right font-bold tabular-nums md:col-span-1">
							<span class="text-small font-semibold text-ink-3 md:hidden">Jumlah </span>{rupiah(
								totals.lines[i] ?? 0
							)}
						</p>
						<div class="col-span-2 flex justify-end gap-1 md:col-span-1">
							<button
								type="button"
								class="bf-icon-btn size-9! disabled:invisible"
								aria-label="Naikkan item {i + 1}"
								disabled={i === 0}
								onclick={() => moveItem(i, -1)}><ChevronUp size={15} strokeWidth={2} /></button
							>
							<button
								type="button"
								class="bf-icon-btn size-9! disabled:invisible"
								aria-label="Turunkan item {i + 1}"
								disabled={i === $form.items.length - 1}
								onclick={() => moveItem(i, 1)}><ChevronDown size={15} strokeWidth={2} /></button
							>
							<button
								type="button"
								class="bf-icon-btn size-9! disabled:invisible"
								aria-label="Hapus item {i + 1}"
								disabled={$form.items.length === 1}
								onclick={() => removeItem(i)}><X size={15} strokeWidth={2} /></button
							>
						</div>
					</li>
				{/each}
			</ol>
			{#if itemsError}<p class="bf-field__error">{itemsError}</p>{/if}
			{#if editable}
				<button type="button" class="bf-btn bf-btn--secondary bf-btn--sm w-fit" onclick={addItem}>
					<Plus size={15} strokeWidth={2} />
					Tambah item
				</button>
			{/if}
		</section>

		<section class="rounded-card bg-surface p-5" aria-label="Catatan">
			<Field
				label="Catatan"
				name="notes"
				errors={$errors.notes}
				hint="Tampil di invoice, mis. termin atau syarat pembayaran"
			>
				{#snippet children(attrs)}
					<textarea {...attrs} bind:value={$form.notes} rows="3" maxlength="2000"></textarea>
				{/snippet}
			</Field>
		</section>
	</fieldset>

	<!-- Totals: live here, recomputed by the server on save (lib/invoice.ts) -->
	<aside
		class="flex flex-col gap-4 rounded-card bg-surface p-5 lg:sticky lg:top-24"
		aria-label="Total"
	>
		<fieldset disabled={!editable} class="flex flex-col gap-2.5">
			<legend class="mb-1 text-small font-bold text-ink-2">Pajak</legend>
			<label class="inline-flex items-center gap-2.5 text-body font-semibold">
				<input
					type="checkbox"
					class="size-5 accent-accent"
					checked={Number($form.ppnRate) > 0}
					onchange={(e) => ($form.ppnRate = e.currentTarget.checked ? DEFAULT_PPN_RATE : 0)}
				/>
				PPN {DEFAULT_PPN_RATE}%
			</label>
			<label class="inline-flex items-center gap-2.5 text-body font-semibold">
				<input
					type="checkbox"
					class="size-5 accent-accent"
					checked={Number($form.pph23Rate) > 0}
					onchange={(e) => ($form.pph23Rate = e.currentTarget.checked ? DEFAULT_PPH23_RATE : 0)}
				/>
				PPh 23 {DEFAULT_PPH23_RATE}% <span class="text-small text-ink-3">(dipotong klien)</span>
			</label>
		</fieldset>
		<dl
			class="flex flex-col gap-2 border-t border-line pt-4 text-body tabular-nums"
			aria-live="polite"
		>
			<div class="flex justify-between gap-3">
				<dt class="text-ink-2">Subtotal</dt>
				<dd class="font-semibold">{rupiah(totals.subtotal)}</dd>
			</div>
			<div class="flex justify-between gap-3">
				<dt class="text-ink-2">PPN {Number($form.ppnRate) || 0}%</dt>
				<dd class="font-semibold">{rupiah(totals.ppnAmount)}</dd>
			</div>
			<div class="flex justify-between gap-3 border-t border-line pt-2 text-[16px]">
				<dt class="font-bold">Total invoice</dt>
				<dd class="font-extrabold">{rupiah(totals.total)}</dd>
			</div>
			<div class="flex justify-between gap-3 text-small">
				<dt class="text-ink-3">PPh 23 dipotong klien</dt>
				<dd class="text-ink-2">−{rupiah(totals.pph23Amount)}</dd>
			</div>
			<div class="flex justify-between gap-3 rounded-control bg-tint-2 px-3 py-2">
				<dt class="font-bold text-ink-2">Diterima di rekening</dt>
				<dd class="font-extrabold text-success">{rupiah(totals.expectedCash)}</dd>
			</div>
		</dl>
		{#if editable}
			<button type="submit" class="bf-btn bf-btn--primary" disabled={$submitting}>
				{$submitting ? 'Menyimpan…' : creating ? 'Simpan draf' : 'Simpan perubahan'}
			</button>
		{/if}
	</aside>
</form>
