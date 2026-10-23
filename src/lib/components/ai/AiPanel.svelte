<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import AiSuggestionCard, {
		type CardOption,
		type SuggestionView
	} from '#lib/components/ai/AiSuggestionCard.svelte';
	import type { StepValue } from '#lib/step-form.ts';

	type Props = {
		suggestions: (SuggestionView & { clientId: string })[];
		showClient?: boolean;
		/** Deal / project options of one client, for general suggestions */
		cardsFor: (clientId: string) => CardOption[];
		assignees: { id: string; name: string }[];
		onaccept: (
			id: string,
			value: StepValue,
			card: string | null
		) => Promise<Record<string, string> | void>;
		ondismiss: (id: string) => Promise<void>;
		/** "Minta saran AI" for this client; omitted = no button */
		onask?: () => Promise<void>;
		/** Cards shown before "Lihat semua" */
		limit?: number;
		class?: string;
	};

	let {
		suggestions,
		showClient = false,
		cardsFor,
		assignees,
		onaccept,
		ondismiss,
		onask,
		limit = 4,
		class: className
	}: Props = $props();

	let all = $state(false);
	let asking = $state(false);
	const shown = $derived(all ? suggestions : suggestions.slice(0, limit));

	async function ask() {
		asking = true;
		try {
			await onask?.();
		} finally {
			asking = false;
		}
	}
</script>

<!-- Saran AI section: ai-line border, agent illustration, the "can be wrong" note at the bottom -->
<section
	class={[
		'flex min-w-0 flex-col gap-3 rounded-card border border-ai-line bg-surface p-5',
		className
	]}
	aria-label="Saran AI"
	aria-busy={asking}
>
	<div class="flex items-center gap-3">
		<img src="/illustrations/agent.webp" alt="" width="44" height="44" class="size-11 shrink-0" />
		<div class="min-w-0 flex-1">
			<h2 class="flex items-center gap-1.5 text-section-title text-ai">
				Saran AI
				{#if suggestions.length}<span class="bf-chip bf-chip--ai">{suggestions.length}</span>{/if}
			</h2>
			<p class="text-small text-ink-3">Dibuat tiap pagi dari riwayat klien · 06:30</p>
		</div>
	</div>

	{#if onask}
		<button
			type="button"
			class="bf-btn bf-btn--ai bf-btn--sm w-fit"
			onclick={ask}
			disabled={asking}
		>
			<Sparkles size={15} strokeWidth={1.9} class={asking ? 'animate-pulse' : ''} />
			{asking ? 'Meminta saran… (bisa 10–30 detik)' : 'Minta saran AI'}
		</button>
	{/if}

	{#if suggestions.length === 0}
		<p class="text-small text-ink-2">Belum ada saran baru. Saran muncul di sini setiap pagi.</p>
	{:else}
		<ul class="flex flex-col gap-2.5">
			{#each shown as s (s.id)}
				<li>
					<AiSuggestionCard
						{s}
						{showClient}
						cards={cardsFor(s.clientId)}
						{assignees}
						{onaccept}
						{ondismiss}
					/>
				</li>
			{/each}
		</ul>
		{#if suggestions.length > limit}
			<button
				type="button"
				class="w-fit text-small font-bold text-ai"
				onclick={() => (all = !all)}
				aria-expanded={all}
			>
				{all ? 'Tampilkan lebih sedikit' : `Lihat semua (${suggestions.length})`}
			</button>
		{/if}
	{/if}

	<p class="bf-ai__note border-t border-ai-line pt-3">
		Saran AI bisa keliru. Periksa dulu sebelum dipakai. Tidak ada yang berubah sebelum Anda
		menyimpannya.
	</p>
</section>
