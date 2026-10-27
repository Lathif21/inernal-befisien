<script lang="ts">
	import Modal from '#lib/components/Modal.svelte';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import { TERMINAL_STAGES } from '#lib/constants.ts';
	import type { PlanCardData } from '#lib/server/services/plans.ts';
	import { newStepValue, type StepValue } from '#lib/step-form.ts';

	type Props = {
		open: boolean;
		plan: PlanCardData | null;
		assignees: { id: string; name: string }[];
		/** Drop the plan; `next` when the card would be left without an open step. Resolves to field errors, or nothing when saved */
		onsubmit: (next: StepValue | null) => Promise<Record<string, string> | void>;
	};

	let { open = $bindable(), plan, assignees, onsubmit }: Props = $props();

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

	const cardTitle = $derived(plan ? (plan.projectName ?? plan.dealTitle ?? '') : '');
	/** Rule 4: an active card keeps one open step after the plan's steps are deleted */
	const needsNext = $derived.by(() => {
		if (!plan || plan.cardOtherOpen > 0) return false;
		const stage = plan.projectId ? plan.projectStage : plan.dealStage;
		return !!stage && !TERMINAL_STAGES.includes(stage);
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const result = await onsubmit(needsNext ? value : null);
			if (result) errors = result;
			else open = false;
		} finally {
			busy = false;
		}
	}
</script>

<!-- "Batalkan rencana" on a plan card: its open steps leave Strategi and the card -->
<Modal bind:open title="Batalkan rencana?" description={plan?.goal ?? ''}>
	<form id="cancel-plan-form" class="flex flex-col gap-4" novalidate onsubmit={submit}>
		{#if plan}
			<p class="text-body text-ink-2">
				{#if plan.openSteps}
					<b class="text-ink">{plan.openSteps} langkah terbuka</b> dari rencana ini dihapus dari {plan.clientName}
					· {cardTitle}. Langkah yang sudah selesai tetap ada di riwayat.
				{:else}
					Rencana ini tidak punya langkah terbuka. Langkah yang sudah selesai tetap ada di riwayat.
				{/if}
			</p>
			{#if needsNext}
				<p class="text-small text-ink-2">
					Semua langkah terbuka di kartu ini ada di rencana ini. Setiap kartu aktif perlu satu
					langkah berikutnya, supaya tidak ada klien yang terlupa.
				</p>
				<StepFields bind:value {assignees} {errors} idPrefix="cancel-plan" autofocus />
			{/if}
		{/if}
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button
			type="submit"
			form="cancel-plan-form"
			class="bf-btn bg-danger-fill text-on-accent"
			disabled={busy}
		>
			{busy ? 'Menyimpan…' : 'Batalkan rencana'}
		</button>
	{/snippet}
</Modal>
