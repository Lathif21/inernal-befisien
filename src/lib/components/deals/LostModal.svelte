<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	import { LOST_REASONS } from '#lib/constants.ts';

	type Props = {
		open: boolean;
		deal: { title: string } | null;
		/** Save the final reason text */
		onsubmit: (reason: string) => Promise<void>;
		/** Dismissed (X / Esc / Batal): the board puts the card back */
		oncancel: () => void;
	};

	let { open = $bindable(), deal, onsubmit, oncancel }: Props = $props();

	let reason = $state('');
	let note = $state('');
	let error = $state('');
	let busy = $state(false);

	$effect(() => {
		if (open) {
			reason = '';
			note = '';
			error = '';
			busy = false;
		}
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!reason) return (error = 'Pilih alasan deal batal.');
		if (reason === 'Lainnya' && note.trim().length < 3) return (error = 'Tuliskan alasannya.');
		error = '';
		busy = true;
		try {
			await onsubmit(note.trim() ? `${reason}: ${note.trim()}` : reason);
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	bind:open
	title="Kenapa deal ini batal?"
	description={deal?.title}
	tone="bg-danger-bg"
	onclose={() => {
		if (!busy) oncancel();
	}}
>
	<form id="lost-form" class="flex flex-col gap-4" novalidate onsubmit={save}>
		<fieldset class="flex flex-col gap-1" aria-describedby={error ? 'lost-error' : undefined}>
			<legend class="mb-2 text-small font-bold text-ink-2"
				>Alasan <span class="text-danger" aria-hidden="true">*</span></legend
			>
			{#each LOST_REASONS as r (r)}
				<label
					class="flex min-h-(--size-touch) cursor-pointer items-center gap-3 rounded-control px-2 text-body font-semibold hover:bg-tint-2"
				>
					<input
						type="radio"
						name="reason"
						value={r}
						bind:group={reason}
						class="size-5 accent-danger-fill"
					/>
					{r}
				</label>
			{/each}
		</fieldset>
		<label class="bf-field">
			Keterangan {reason === 'Lainnya' ? '(wajib)' : '(opsional)'}
			<textarea
				bind:value={note}
				rows="2"
				maxlength="400"
				placeholder="Contoh: memilih vendor lokal yang lebih murah"></textarea>
		</label>
		{#if error}<p id="lost-error" role="alert" class="bf-field__error">{error}</p>{/if}
	</form>

	{#snippet footer()}
		<button
			type="button"
			class="bf-btn bf-btn--secondary"
			disabled={busy}
			onclick={() => (open = false)}>Batal</button
		>
		<button
			type="submit"
			form="lost-form"
			class="bf-btn bg-danger-fill text-on-accent"
			disabled={busy}
		>
			{busy ? 'Menyimpan…' : 'Simpan alasan'}
		</button>
	{/snippet}
</Modal>
