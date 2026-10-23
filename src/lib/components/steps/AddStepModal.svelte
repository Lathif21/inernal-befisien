<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import { newStepValue, type StepValue } from '#lib/step-form.ts';

	type Props = {
		open: boolean;
		cardTitle: string;
		assignees: { id: string; name: string }[];
		/** Save; resolves to field errors, or nothing when saved */
		onsubmit: (value: StepValue) => Promise<Record<string, string> | void>;
	};

	let { open = $bindable(), cardTitle, assignees, onsubmit }: Props = $props();

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

<!-- From the dashed "+ Tambah langkah berikutnya" box on a card -->
<Modal bind:open title="Tambah langkah berikutnya" description={cardTitle}>
	<form id="add-step-form" novalidate onsubmit={save}>
		<StepFields bind:value {assignees} {errors} idPrefix="add-step" autofocus />
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form="add-step-form" class="bf-btn bf-btn--primary" disabled={busy}>
			{busy ? 'Menyimpan…' : 'Simpan langkah'}
		</button>
	{/snippet}
</Modal>
