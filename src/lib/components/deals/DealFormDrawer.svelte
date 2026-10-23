<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import {
		DEAL_STAGE_META,
		OPEN_DEAL_STAGES,
		SERVICE_TYPE_LABELS,
		SERVICE_TYPES,
		type ServiceType
	} from '#lib/constants.ts';
	import { dateToWibLocal } from '#lib/format.ts';
	import type { DealInput } from '#lib/schemas/deal.ts';
	import type { FormMessage } from '#lib/schemas/message.ts';
	import { toast } from '#lib/toast.ts';

	export type EditableDeal = {
		id: string;
		clientId: string;
		title: string;
		serviceType: ServiceType | null;
		valueEstimate: number | null;
		expectedClose: string | null;
		ownerId: string | null;
	};

	type Props = {
		form: SuperValidated<DealInput, FormMessage>;
		clients: { id: string; name: string }[];
		owners: { id: string; name: string }[];
		action?: string;
	};

	let { form: initial, clients, owners, action = '?/saveDeal' }: Props = $props();

	let open = $state(false);
	let editingTitle = $state<string | null>(null);

	const { form, errors, enhance, submitting, message, reset } = superForm(
		untrack(() => initial),
		{
			id: 'deal-form',
			dataType: 'form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					open = false;
					toast.success(form.message.text);
				}
			}
		}
	);

	/** Tomorrow 10:00 WIB, the usual first follow-up */
	function tomorrowAt10() {
		const t = new Date(Date.now() + 24 * 60 * 60 * 1000);
		return `${dateToWibLocal(t).slice(0, 10)}T10:00`;
	}

	export function openCreate(
		prefill: { clientId?: string; stage?: (typeof OPEN_DEAL_STAGES)[number] } = {}
	) {
		editingTitle = null;
		reset({
			data: {
				clientId: prefill.clientId ?? '',
				stage: prefill.stage ?? 'lead',
				firstStepTitle: 'Hubungi klien',
				firstStepDue: tomorrowAt10()
			}
		});
		open = true;
	}

	export function openEdit(d: EditableDeal) {
		editingTitle = d.title;
		reset({
			data: {
				id: d.id,
				clientId: d.clientId,
				title: d.title,
				serviceType: d.serviceType ?? '',
				valueEstimate: d.valueEstimate,
				expectedClose: d.expectedClose ?? '',
				ownerId: d.ownerId ?? ''
			}
		});
		open = true;
	}

	const creating = $derived(!$form.id);
</script>

<Drawer
	bind:open
	title={editingTitle ? 'Edit deal' : 'Tambah deal'}
	description={editingTitle ?? 'Deal baru masuk ke board Pipeline Sales.'}
>
	<form id="deal-form" method="post" {action} use:enhance class="flex flex-col gap-4" novalidate>
		<input type="hidden" name="id" bind:value={$form.id} />

		{#if $message?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$message.text}
			</p>
		{/if}

		<Field label="Klien" name="clientId" required errors={$errors.clientId}>
			{#snippet children(attrs)}
				{#if creating}
					<select {...attrs} bind:value={$form.clientId}>
						<option value="">Pilih klien</option>
						{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					</select>
				{:else}
					<!-- the client of an existing deal does not change -->
					<input type="hidden" name="clientId" value={$form.clientId} />
					<input
						id={attrs.id}
						value={clients.find((c) => c.id === $form.clientId)?.name ?? ''}
						readonly
						class="bg-tint-2!"
					/>
				{/if}
			{/snippet}
		</Field>

		<Field label="Judul deal" name="title" required errors={$errors.title}>
			{#snippet children(attrs)}
				<input
					{...attrs}
					bind:value={$form.title}
					maxlength="150"
					placeholder="AI Agent pengadaan barang"
				/>
			{/snippet}
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Layanan" name="serviceType" errors={$errors.serviceType}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.serviceType}>
						<option value="">Pilih layanan</option>
						{#each SERVICE_TYPES as s (s)}<option value={s}>{SERVICE_TYPE_LABELS[s]}</option>{/each}
					</select>
				{/snippet}
			</Field>
			{#if creating}
				<Field label="Tahap awal" name="stage" errors={$errors.stage}>
					{#snippet children(attrs)}
						<select {...attrs} bind:value={$form.stage}>
							{#each OPEN_DEAL_STAGES as s (s)}<option value={s}>{DEAL_STAGE_META[s].label}</option
								>{/each}
						</select>
					{/snippet}
				</Field>
			{/if}
			<Field label="Perkiraan nilai" name="valueEstimate" errors={$errors.valueEstimate}>
				{#snippet children(attrs)}
					<MoneyInput
						id={attrs.id}
						name="valueEstimate"
						bind:value={$form.valueEstimate}
						aria-invalid={attrs['aria-invalid']}
						aria-describedby={attrs['aria-describedby']}
					/>
				{/snippet}
			</Field>
			<Field label="Target closing" name="expectedClose" errors={$errors.expectedClose}>
				{#snippet children(attrs)}
					<input {...attrs} type="date" bind:value={$form.expectedClose} />
				{/snippet}
			</Field>
			<Field label="Pemilik" name="ownerId" errors={$errors.ownerId} hint="Kosong = Anda">
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.ownerId}>
						<option value="">Pilih pemilik</option>
						{#each owners as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				{/snippet}
			</Field>
		</div>

		{#if creating}
			<fieldset class="flex flex-col gap-4 rounded-kanban border border-line p-4">
				<legend class="px-1 text-small font-bold text-ink-2">Langkah pertama</legend>
				<Field label="Langkah" name="firstStepTitle" required errors={$errors.firstStepTitle}>
					{#snippet children(attrs)}
						<input {...attrs} bind:value={$form.firstStepTitle} maxlength="200" />
					{/snippet}
				</Field>
				<Field
					label="Tanggal & jam (WIB)"
					name="firstStepDue"
					required
					errors={$errors.firstStepDue}
				>
					{#snippet children(attrs)}
						<input {...attrs} type="datetime-local" bind:value={$form.firstStepDue} />
					{/snippet}
				</Field>
			</fieldset>
		{/if}
	</form>

	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form="deal-form" class="bf-btn bf-btn--primary" disabled={$submitting}>
			{$submitting ? 'Menyimpan…' : 'Simpan deal'}
		</button>
	{/snippet}
</Drawer>
