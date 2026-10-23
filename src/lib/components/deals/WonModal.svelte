<script lang="ts">
	import PartyPopper from '@lucide/svelte/icons/party-popper';
	import Modal from '#lib/components/Modal.svelte';
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import { dateToWibLocal, dayKeyWib } from '#lib/format.ts';

	export type WonFields = {
		projectName: string;
		contractValue: string;
		startDate: string;
		firstStepTitle: string;
		firstStepDue: string;
	};

	type Props = {
		open: boolean;
		/** The deal that was won */
		deal: { title: string; valueEstimate: number | null } | null;
		/**
		 * `move`: shown after dropping on Deal ✓ ("Nanti saja" keeps the deal won without a project).
		 * `later`: "Buat proyek" from the drawer of a won deal.
		 */
		mode: 'move' | 'later';
		/** Field errors from the server, keyed by field name */
		errors?: Record<string, string>;
		/** Save; `null` = "Nanti saja" */
		onsubmit: (fields: WonFields | null) => Promise<void>;
		/** Dismissed (X / Esc): the board puts the card back */
		oncancel: () => void;
	};

	let { open = $bindable(), deal, mode, errors = {}, onsubmit, oncancel }: Props = $props();

	let projectName = $state('');
	let contractValue = $state<number | null>(null);
	let startDate = $state('');
	let firstStepTitle = $state('');
	let firstStepDue = $state('');
	let busy = $state<'save' | 'later' | null>(null);

	// Fresh defaults each time it opens (docs/03-SCREENS.md: Kick-off meeting, +3 days 10:00)
	$effect(() => {
		if (open && deal) {
			projectName = deal.title;
			contractValue = deal.valueEstimate;
			startDate = dayKeyWib();
			firstStepTitle = 'Kick-off meeting';
			firstStepDue = `${dateToWibLocal(Date.now() + 3 * 24 * 60 * 60 * 1000).slice(0, 10)}T10:00`;
			busy = null;
		}
	});

	async function save(withProject: boolean) {
		busy = withProject ? 'save' : 'later';
		try {
			await onsubmit(
				withProject
					? {
							projectName,
							contractValue: contractValue === null ? '' : String(contractValue),
							startDate,
							firstStepTitle,
							firstStepDue
						}
					: null
			);
		} finally {
			busy = null;
		}
	}
</script>

<Modal
	bind:open
	title={mode === 'move' ? 'Deal menang! Buat proyek sekarang?' : 'Buat proyek dari deal ini'}
	description={deal?.title}
	tone="bg-success-bg"
	onclose={() => {
		if (!busy) oncancel();
	}}
>
	<form
		id="won-form"
		class="flex flex-col gap-4"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			save(true);
		}}
	>
		{#if mode === 'move'}
			<p class="flex items-center gap-2 text-small font-semibold text-success">
				<PartyPopper size={16} strokeWidth={1.9} aria-hidden="true" />
				Proyek baru masuk ke kolom Onboarding di board Proyek.
			</p>
		{/if}
		<Field
			label="Nama proyek"
			name="projectName"
			required
			errors={errors.projectName ? [errors.projectName] : undefined}
		>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={projectName} maxlength="150" />
			{/snippet}
		</Field>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field
				label="Nilai kontrak"
				name="contractValue"
				required
				errors={errors.contractValue ? [errors.contractValue] : undefined}
			>
				{#snippet children(attrs)}
					<MoneyInput
						id={attrs.id}
						name="contractValue"
						bind:value={contractValue}
						aria-invalid={attrs['aria-invalid']}
						aria-describedby={attrs['aria-describedby']}
					/>
				{/snippet}
			</Field>
			<Field
				label="Tanggal mulai"
				name="startDate"
				required
				errors={errors.startDate ? [errors.startDate] : undefined}
			>
				{#snippet children(attrs)}
					<input {...attrs} type="date" bind:value={startDate} />
				{/snippet}
			</Field>
		</div>
		<fieldset class="flex flex-col gap-4 rounded-kanban border border-line p-4">
			<legend class="px-1 text-small font-bold text-ink-2">Langkah pertama proyek</legend>
			<Field
				label="Langkah"
				name="firstStepTitle"
				required
				errors={errors.firstStepTitle ? [errors.firstStepTitle] : undefined}
			>
				{#snippet children(attrs)}
					<input {...attrs} bind:value={firstStepTitle} maxlength="200" />
				{/snippet}
			</Field>
			<Field
				label="Tanggal & jam (WIB)"
				name="firstStepDue"
				required
				errors={errors.firstStepDue ? [errors.firstStepDue] : undefined}
			>
				{#snippet children(attrs)}
					<input {...attrs} type="datetime-local" bind:value={firstStepDue} />
				{/snippet}
			</Field>
		</fieldset>
	</form>

	{#snippet footer()}
		{#if mode === 'move'}
			<button
				type="button"
				class="bf-btn bf-btn--secondary"
				disabled={!!busy}
				onclick={() => save(false)}
			>
				{busy === 'later' ? 'Menyimpan…' : 'Nanti saja'}
			</button>
		{:else}
			<button
				type="button"
				class="bf-btn bf-btn--secondary"
				disabled={!!busy}
				onclick={() => (open = false)}
			>
				Batal
			</button>
		{/if}
		<button type="submit" form="won-form" class="bf-btn bf-btn--primary" disabled={!!busy}>
			{busy === 'save' ? 'Membuat…' : 'Buat Proyek'}
		</button>
	{/snippet}
</Modal>
