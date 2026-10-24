<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import { newStepValue, type StepValue } from '#lib/step-form.ts';

	type Props = {
		open: boolean;
		/** The step just ticked off */
		completedTitle: string;
		cardTitle: string;
		/** Won / lost / done cards may skip the next step (docs/02-DATA-MODEL.md rule 4) */
		canSkip: boolean;
		/** "Pindahkan ke …" option, or null when the card has no next stage here */
		nextStageLabel: string | null;
		assignees: { id: string; name: string }[];
		errors?: Record<string, string>;
		/** Complete the step; `next` null = skipped */
		onsubmit: (next: StepValue | null, moveToNextStage: boolean) => Promise<void>;
		/** Closed without saving: the step stays open */
		oncancel: () => void;
	};

	let {
		open = $bindable(),
		completedTitle,
		cardTitle,
		canSkip,
		nextStageLabel,
		assignees,
		errors = {},
		onsubmit,
		oncancel
	}: Props = $props();

	let value = $state<StepValue>(newStepValue());
	let move = $state(false);
	let busy = $state<'save' | 'skip' | null>(null);

	$effect(() => {
		if (open) {
			value = newStepValue();
			move = false;
			busy = null;
		}
	});

	/** The footer button closes by setting `open`, which bits-ui does not report as a dismiss */
	function cancel() {
		open = false;
		oncancel();
	}

	async function submit(withNext: boolean) {
		busy = withNext ? 'save' : 'skip';
		try {
			await onsubmit(withNext ? value : null, withNext && move);
		} finally {
			busy = null;
		}
	}
</script>

<!-- "Langkah berikutnya?" after the last open step of a card (docs/05-PHASES.md P1-07) -->
<Modal
	bind:open
	title="Langkah berikutnya?"
	description="{cardTitle} · selesai: {completedTitle}"
	onclose={() => {
		if (!busy) oncancel();
	}}
>
	<form
		id="next-step-form"
		class="flex flex-col gap-4"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			submit(true);
		}}
	>
		<p class="text-small text-ink-2">
			{canSkip
				? 'Kartu ini sudah ditutup, jadi langkah berikutnya boleh dilewati.'
				: 'Setiap kartu aktif perlu satu langkah berikutnya, supaya tidak ada klien yang terlupa.'}
		</p>
		<StepFields bind:value {assignees} {errors} idPrefix="next-step" autofocus />
		{#if nextStageLabel}
			<label
				class="inline-flex min-h-(--size-touch) items-center gap-2.5 rounded-control bg-tint-2 px-3 text-body font-semibold"
			>
				<input type="checkbox" bind:checked={move} class="size-5 accent-accent" />
				Pindahkan ke {nextStageLabel}
			</label>
		{/if}
	</form>

	{#snippet footer()}
		{#if canSkip}
			<button
				type="button"
				class="bf-btn bf-btn--secondary"
				disabled={!!busy}
				onclick={() => submit(false)}
			>
				{busy === 'skip' ? 'Menyimpan…' : 'Lewati'}
			</button>
		{:else}
			<button type="button" class="bf-btn bf-btn--secondary" disabled={!!busy} onclick={cancel}>
				Batal
			</button>
		{/if}
		<button type="submit" form="next-step-form" class="bf-btn bf-btn--primary" disabled={!!busy}>
			{busy === 'save' ? 'Menyimpan…' : 'Simpan langkah'}
		</button>
	{/snippet}
</Modal>
