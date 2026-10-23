<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import { SERVICE_TYPE_LABELS, SERVICE_TYPES, type ServiceType } from '#lib/constants.ts';
	import type { FormMessage } from '#lib/schemas/message.ts';
	import type { ProjectInput } from '#lib/schemas/project.ts';
	import { toast } from '#lib/toast.ts';

	export type EditableProject = {
		id: string;
		name: string;
		clientName: string;
		serviceType: ServiceType | null;
		contractValue: number | null;
		startDate: string | null;
		targetEndDate: string | null;
		ownerId: string | null;
	};

	type Props = {
		form: SuperValidated<ProjectInput, FormMessage>;
		owners: { id: string; name: string }[];
	};

	let { form: initial, owners }: Props = $props();

	let open = $state(false);
	let editing = $state<EditableProject | null>(null);

	const { form, errors, enhance, submitting, message, reset } = superForm(
		untrack(() => initial),
		{
			id: 'project-form',
			dataType: 'form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					open = false;
					toast.success(form.message.text);
				}
			}
		}
	);

	/** Projects are created from won deals, so the drawer only edits */
	export function openEdit(p: EditableProject) {
		editing = p;
		reset({
			data: {
				id: p.id,
				name: p.name,
				serviceType: p.serviceType ?? '',
				contractValue: p.contractValue,
				startDate: p.startDate ?? '',
				targetEndDate: p.targetEndDate ?? '',
				ownerId: p.ownerId ?? ''
			}
		});
		open = true;
	}
</script>

<Drawer bind:open title="Edit proyek" description={editing?.clientName}>
	<form
		id="project-form"
		method="post"
		action="?/saveProject"
		use:enhance
		class="flex flex-col gap-4"
		novalidate
	>
		<input type="hidden" name="id" bind:value={$form.id} />

		{#if $message?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$message.text}
			</p>
		{/if}

		<Field label="Nama proyek" name="name" required errors={$errors.name}>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={$form.name} maxlength="150" />
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
			<Field
				label="Nilai kontrak"
				name="contractValue"
				errors={$errors.contractValue}
				hint="Sebelum pajak"
			>
				{#snippet children(attrs)}
					<MoneyInput
						id={attrs.id}
						name="contractValue"
						bind:value={$form.contractValue}
						aria-invalid={attrs['aria-invalid']}
						aria-describedby={attrs['aria-describedby']}
					/>
				{/snippet}
			</Field>
			<Field label="Tanggal mulai" name="startDate" errors={$errors.startDate}>
				{#snippet children(attrs)}
					<input {...attrs} type="date" bind:value={$form.startDate} />
				{/snippet}
			</Field>
			<Field label="Target selesai" name="targetEndDate" errors={$errors.targetEndDate}>
				{#snippet children(attrs)}
					<input {...attrs} type="date" bind:value={$form.targetEndDate} />
				{/snippet}
			</Field>
			<Field label="Pemilik" name="ownerId" errors={$errors.ownerId}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.ownerId}>
						<option value="">Pilih pemilik</option>
						{#each owners as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				{/snippet}
			</Field>
		</div>
	</form>

	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form="project-form" class="bf-btn bf-btn--primary" disabled={$submitting}>
			{$submitting ? 'Menyimpan…' : 'Simpan proyek'}
		</button>
	{/snippet}
</Drawer>
