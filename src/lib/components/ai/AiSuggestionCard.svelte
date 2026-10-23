<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import { AI_KIND_LABELS, type AiKind } from '#lib/constants.ts';
	import { dateID } from '#lib/format.ts';
	import { newStepValue, stepValueOf, type StepValue } from '#lib/step-form.ts';

	export type CardOption = { value: string; label: string };
	export type SuggestionView = {
		id: string;
		kind: AiKind;
		insight: string;
		proposedAction: string;
		proposedDueAt: Date | string | null;
		clientName: string;
		cardTitle: string | null;
		dealId: string | null;
		projectId: string | null;
		planId: string | null;
	};

	type Props = {
		s: SuggestionView;
		/** Strategi lists every client; the client page does not repeat its name */
		showClient?: boolean;
		/** Deals / projects of this client ("deal:<id>" / "project:<id>"), for general suggestions */
		cards: CardOption[];
		assignees: { id: string; name: string }[];
		/** Resolves to field errors, or nothing when the step was created */
		onaccept: (
			id: string,
			value: StepValue,
			card: string | null
		) => Promise<Record<string, string> | void>;
		ondismiss: (id: string) => Promise<void>;
	};

	let { s, showClient = false, cards, assignees, onaccept, ondismiss }: Props = $props();

	const general = $derived(!s.dealId && !s.projectId);
	let editing = $state(false);
	let value = $state<StepValue>(newStepValue());
	let card = $state('');
	let errors = $state<Record<string, string>>({});
	let busy = $state<'accept' | 'dismiss' | null>(null);

	function openAccept() {
		value = s.proposedDueAt
			? stepValueOf({
					title: s.proposedAction,
					dueAt: s.proposedDueAt,
					allDay: false,
					assigneeId: null
				})
			: newStepValue(s.proposedAction);
		card = general && cards.length === 1 ? cards[0].value : '';
		errors = {};
		editing = true;
	}

	async function accept(e: SubmitEvent) {
		e.preventDefault();
		if (general && !card) {
			errors = { target: 'Pilih deal atau proyek untuk langkah ini.' };
			return;
		}
		busy = 'accept';
		try {
			const result = await onaccept(s.id, value, general ? card : null);
			if (result) errors = result;
		} finally {
			busy = null;
		}
	}

	async function dismiss() {
		busy = 'dismiss';
		try {
			await ondismiss(s.id);
		} finally {
			busy = null;
		}
	}
</script>

<!-- AiSuggestion (docs/design-system/components/AiSuggestion): kind, insight in bold, action under it -->
<article class="bf-ai border border-ai-line" aria-label="Saran AI: {s.proposedAction}">
	<div class="flex flex-wrap items-center gap-2">
		<span class="bf-ai__kind inline-flex items-center gap-1">
			<Sparkles size={12} strokeWidth={2.2} aria-hidden="true" />{AI_KIND_LABELS[s.kind]}
		</span>
		<span class="min-w-0 flex-1 truncate text-right text-[12px] font-semibold text-ink-3">
			{showClient ? s.clientName : ''}{showClient && s.cardTitle ? ' · ' : ''}{s.cardTitle ??
				(showClient ? '' : 'Klien')}
		</span>
	</div>
	<p class="bf-ai__insight">{s.insight}</p>
	<p class="bf-ai__action">
		{s.proposedAction}{#if s.proposedDueAt}<span class="font-semibold text-ai">
				· {dateID(s.proposedDueAt, 'datetime')}</span
			>{/if}
	</p>

	{#if editing}
		<form class="flex flex-col gap-3 rounded-control bg-surface p-3" onsubmit={accept} novalidate>
			{#if general}
				<label class="flex flex-col gap-1.5 text-small font-bold text-ink-2">
					Untuk deal atau proyek
					<select
						bind:value={card}
						class="min-h-10 rounded-control border border-line bg-surface px-3 text-body font-medium text-ink"
						aria-invalid={errors.target ? 'true' : undefined}
					>
						<option value="">Pilih…</option>
						{#each cards as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
					</select>
					{#if errors.target}<span class="bf-field__error">{errors.target}</span>{/if}
					{#if cards.length === 0}
						<span class="text-small font-semibold text-ink-3"
							>Klien ini belum punya deal atau proyek aktif.</span
						>
					{/if}
				</label>
			{/if}
			<StepFields bind:value {assignees} {errors} idPrefix="ai-{s.id}" />
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="bf-btn bf-btn--secondary bf-btn--sm"
					onclick={() => (editing = false)}>Batal</button
				>
				<button type="submit" class="bf-btn bf-btn--ai-solid bf-btn--sm" disabled={!!busy}>
					{busy === 'accept' ? 'Menyimpan…' : 'Simpan langkah'}
				</button>
			</div>
		</form>
	{:else}
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="bf-btn bf-btn--ai-solid bf-btn--sm"
				onclick={openAccept}
				disabled={!!busy}
			>
				{s.planId ? 'Tambahkan ke rencana' : 'Buat langkah'}
			</button>
			<button
				type="button"
				class="bf-btn bf-btn--ghost bf-btn--sm"
				onclick={dismiss}
				disabled={!!busy}
			>
				{busy === 'dismiss' ? 'Mengabaikan…' : 'Abaikan'}
			</button>
		</div>
	{/if}
</article>
