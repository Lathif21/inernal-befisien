<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import { newStepValue, type StepValue } from '#lib/step-form.ts';

	export type ReopenInfo = {
		title: string;
		fromLabel: string;
		toLabel: string;
		/** Leaving Deal ✓ deletes the project made from the deal */
		hasProject: boolean;
		/** No open step left (a lost deal had them all closed): ask for the next one */
		needsStep: boolean;
	};

	type Props = {
		open: boolean;
		deal: ReopenInfo | null;
		assignees: { id: string; name: string }[];
		/** Save; resolves to field errors, or nothing when saved */
		onsubmit: (next: StepValue | null) => Promise<Record<string, string> | void>;
		/** Dismissed (X / Esc / Batal): the board puts the card back */
		oncancel: () => void;
	};

	let { open = $bindable(), deal, assignees, onsubmit, oncancel }: Props = $props();

	let value = $state<StepValue>(newStepValue());
	let errors = $state<Record<string, string>>({});
	let busy = $state(false);

	$effect(() => {
		if (open) {
			value = newStepValue();
			errors = {};
			busy = false;
		}
	});

	/** Setting `open` is not reported by bits-ui as a dismiss, so the board is told here */
	function cancel() {
		open = false;
		oncancel();
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const result = await onsubmit(deal?.needsStep ? value : null);
			if (result) errors = result;
		} finally {
			busy = false;
		}
	}
</script>

<!-- Moving a card out of Deal ✓ or Batal (fixing a human error) -->
<Modal
	bind:open
	title={deal?.fromLabel === 'Batal' ? 'Buka lagi deal ini?' : `Pindahkan dari ${deal?.fromLabel}?`}
	description={deal?.title}
	onclose={() => {
		if (!busy) oncancel();
	}}
>
	<form id="reopen-form" class="flex flex-col gap-4" novalidate onsubmit={save}>
		<p class="text-body text-ink-2">
			Deal pindah dari <b class="text-ink">{deal?.fromLabel}</b> ke
			<b class="text-ink">{deal?.toLabel}</b>.
		</p>
		{#if deal?.hasProject}
			<p class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-semibold text-danger">
				Proyek yang dibuat dari deal ini akan dihapus, beserta langkah-langkahnya. Tidak bisa jika
				proyek itu sudah punya transaksi atau invoice.
			</p>
		{/if}
		{#if deal?.needsStep}
			<div class="flex flex-col gap-3">
				<h3 class="text-small font-bold text-ink-2">Langkah berikutnya</h3>
				<StepFields bind:value {assignees} {errors} idPrefix="reopen-step" autofocus />
			</div>
		{/if}
		{#if errors._}<p role="alert" class="bf-field__error">{errors._}</p>{/if}
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" disabled={busy} onclick={cancel}
			>Batal</button
		>
		<button
			type="submit"
			form="reopen-form"
			class={['bf-btn', deal?.hasProject ? 'bg-danger-fill text-on-accent' : 'bf-btn--primary']}
			disabled={busy}
		>
			{busy ? 'Menyimpan…' : deal?.hasProject ? 'Hapus proyek & pindahkan' : 'Pindahkan'}
		</button>
	{/snippet}
</Modal>
