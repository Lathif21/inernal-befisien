<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
	import Field from '#lib/components/form/Field.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import {
		CLIENT_SOURCE_LABELS,
		CLIENT_SOURCES,
		CLIENT_STATUS_LABELS,
		INDUSTRIES,
		INDUSTRY_LABELS,
		type ClientSource,
		type ClientStatus,
		type Industry
	} from '#lib/constants.ts';
	import { EDITABLE_CLIENT_STATUSES, type ClientInput } from '#lib/schemas/client.ts';
	import type { FormMessage } from '#lib/schemas/message.ts';
	import { toast } from '#lib/toast.ts';

	/** The stored client fields the form edits (list row or detail record) */
	export type EditableClient = {
		id: string;
		name: string;
		industry: Industry | null;
		source: ClientSource | null;
		status: ClientStatus;
		city: string | null;
		address: string | null;
		website: string | null;
		npwp: string | null;
		ownerId: string | null;
		notes: string | null;
	};

	type Props = {
		/** From `superValidate(zod4(clientSchema))` in the page load */
		form: SuperValidated<ClientInput, FormMessage>;
		owners: { id: string; name: string }[];
		/** Form action that runs saveClientForm() */
		action?: string;
	};

	let { form: initial, owners, action = '?/save' }: Props = $props();

	let open = $state(false);
	let editingName = $state<string | null>(null);

	const { form, errors, enhance, submitting, message, reset } = superForm(
		untrack(() => initial),
		{
			id: 'client-form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					open = false;
					toast.success(form.message.text);
				}
			}
		}
	);

	export function openCreate() {
		editingName = null;
		reset();
		open = true;
	}

	export function openEdit(c: EditableClient) {
		editingName = c.name;
		reset({
			data: {
				id: c.id,
				name: c.name,
				industry: c.industry ?? '',
				source: c.source ?? '',
				// archived clients cannot be edited; anything else maps onto an editable status
				status: (EDITABLE_CLIENT_STATUSES as readonly string[]).includes(c.status)
					? (c.status as (typeof EDITABLE_CLIENT_STATUSES)[number])
					: 'inactive',
				city: c.city ?? '',
				address: c.address ?? '',
				website: c.website ?? '',
				npwp: c.npwp ?? '',
				ownerId: c.ownerId ?? '',
				notes: c.notes ?? ''
			}
		});
		open = true;
	}
</script>

<Drawer
	bind:open
	title={editingName ? 'Edit klien' : 'Tambah klien'}
	description={editingName ?? 'Data perusahaan. Kontak ditambahkan di halaman detail klien.'}
>
	<form id="client-form" method="post" {action} use:enhance class="flex flex-col gap-4" novalidate>
		<input type="hidden" name="id" bind:value={$form.id} />

		{#if $message?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$message.text}
			</p>
		{/if}

		<Field label="Nama klien" name="name" required errors={$errors.name}>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={$form.name} autocomplete="organization" maxlength="120" />
			{/snippet}
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Status" name="status" errors={$errors.status}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.status}>
						{#each EDITABLE_CLIENT_STATUSES as s (s)}<option value={s}
								>{CLIENT_STATUS_LABELS[s]}</option
							>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Industri" name="industry" errors={$errors.industry}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.industry}>
						<option value="">Pilih industri</option>
						{#each INDUSTRIES as ind (ind)}<option value={ind}>{INDUSTRY_LABELS[ind]}</option
							>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Sumber" name="source" errors={$errors.source}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.source}>
						<option value="">Pilih sumber</option>
						{#each CLIENT_SOURCES as s (s)}<option value={s}>{CLIENT_SOURCE_LABELS[s]}</option
							>{/each}
					</select>
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

		<Field label="Kota" name="city" errors={$errors.city}>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={$form.city} autocomplete="address-level2" maxlength="80" />
			{/snippet}
		</Field>
		<Field label="Alamat" name="address" errors={$errors.address}>
			{#snippet children(attrs)}
				<textarea {...attrs} bind:value={$form.address} rows="2" autocomplete="street-address"
				></textarea>
			{/snippet}
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Website" name="website" errors={$errors.website}>
				{#snippet children(attrs)}
					<input
						{...attrs}
						bind:value={$form.website}
						inputmode="url"
						placeholder="contoh.co.id"
						maxlength="200"
					/>
				{/snippet}
			</Field>
			<Field label="NPWP" name="npwp" errors={$errors.npwp} hint="Untuk invoice (Fase 2)">
				{#snippet children(attrs)}
					<input {...attrs} bind:value={$form.npwp} inputmode="numeric" maxlength="24" />
				{/snippet}
			</Field>
		</div>

		<Field label="Catatan" name="notes" errors={$errors.notes}>
			{#snippet children(attrs)}
				<textarea {...attrs} bind:value={$form.notes} rows="4"></textarea>
			{/snippet}
		</Field>
	</form>

	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}>
			Batal
		</button>
		<button type="submit" form="client-form" class="bf-btn bf-btn--primary" disabled={$submitting}>
			{$submitting ? 'Menyimpan…' : 'Simpan klien'}
		</button>
	{/snippet}
</Drawer>
