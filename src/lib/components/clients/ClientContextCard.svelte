<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ResolvedPathname } from '$app/types';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { dateID } from '#lib/format.ts';

	type Props = {
		clientId: string;
		context: {
			summary: string;
			source: string;
			updatedAt: Date | string;
			updatedByName: string | null;
		} | null;
		/** Edit + "Perbarui dengan AI" (client page, not archived) */
		editable?: boolean;
		aiEnabled?: boolean;
		/** Deal drawer: a smaller, read-only block with a link to the client page */
		compact?: boolean;
		clientHref?: ResolvedPathname;
	};

	let {
		clientId,
		context,
		editable = false,
		aiEnabled = false,
		compact = false,
		clientHref
	}: Props = $props();

	let editing = $state(false);
	let refreshing = $state(false);
	let saving = $state(false);
	/** Compact view: long summaries start clamped to 6 lines */
	let expanded = $state(false);

	const meta = $derived(
		context
			? `${context.source === 'team' ? `Diedit ${context.updatedByName ?? 'tim'}` : 'Disusun AI'} · ${dateID(context.updatedAt, 'datetime')}`
			: null
	);
</script>

<!-- What Befisien knows about this client, condensed from the whole history (services/client-context.ts) -->
<section
	class={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-3 rounded-card bg-surface p-5'}
	aria-labelledby="ctx-title-{clientId}"
>
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="min-w-0">
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id="ctx-title-{clientId}"
				class={compact ? 'text-small font-bold text-ink-2' : 'text-section-title'}
				>Ringkasan konteks klien</svelte:element
			>
			{#if meta}<p class="text-small text-ink-3">{meta}</p>{/if}
		</div>
		{#if editable && !editing}
			<div class="flex flex-wrap gap-1.5">
				<button
					type="button"
					class="bf-btn bf-btn--ghost bf-btn--sm"
					onclick={() => (editing = true)}
				>
					<Pencil size={14} strokeWidth={1.9} />
					Edit
				</button>
				{#if aiEnabled}
					<form
						method="post"
						action="?/refreshContext"
						use:enhance={refreshThenToast({
							start: () => (refreshing = true),
							end: () => (refreshing = false)
						})}
					>
						<input type="hidden" name="clientId" value={clientId} />
						<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm" disabled={refreshing}>
							<Sparkles size={14} strokeWidth={1.9} />
							{refreshing ? 'Menyusun…' : 'Perbarui dengan AI'}
						</button>
					</form>
				{/if}
			</div>
		{/if}
	</div>

	{#if editing}
		<form
			method="post"
			action="?/saveContext"
			class="flex flex-col gap-2"
			use:enhance={refreshThenToast({
				start: () => (saving = true),
				end: (ok) => {
					saving = false;
					if (ok) editing = false;
				}
			})}
		>
			<input type="hidden" name="clientId" value={clientId} />
			<label class="sr-only" for="ctx-text-{clientId}">Ringkasan konteks klien</label>
			<textarea
				id="ctx-text-{clientId}"
				name="summary"
				rows="12"
				maxlength="4000"
				defaultValue={context?.summary ?? ''}
				placeholder="Profil & kebutuhan, orang kunci, riwayat deal, preferensi, pembayaran…"
				class="w-full rounded-control border border-line px-3 py-2.5 text-body"></textarea>
			<p class="text-small text-ink-3">
				AI melanjutkan dari teks ini saat riwayat baru masuk, jadi fakta yang Anda tulis tetap
				dipakai.
			</p>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="bf-btn bf-btn--secondary bf-btn--sm"
					onclick={() => (editing = false)}>Batal</button
				>
				<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm" disabled={saving}>
					{saving ? 'Menyimpan…' : 'Simpan'}
				</button>
			</div>
		</form>
	{:else if context}
		{@const long = compact && context.summary.split('\n').length > 6}
		<p
			id="ctx-text-view-{clientId}"
			class={[
				'whitespace-pre-line text-ink',
				compact ? 'text-small' : 'text-body',
				long && !expanded && 'line-clamp-6'
			]}
		>
			{context.summary}
		</p>
		{#if long}
			<button
				type="button"
				class="w-fit text-small font-bold text-accent-ink"
				aria-expanded={expanded}
				aria-controls="ctx-text-view-{clientId}"
				onclick={() => (expanded = !expanded)}>{expanded ? 'Ringkas' : 'Tampilkan semua'}</button
			>
		{/if}
	{:else}
		<p class="rounded-control bg-tint-2 px-3.5 py-3 text-small font-semibold text-ink-2">
			Belum ada ringkasan. AI menyusunnya dari seluruh riwayat klien (deal, alasan batal, catatan,
			pembayaran) setiap pagi, atau sekarang lewat "Perbarui dengan AI".
		</p>
	{/if}

	{#if compact && clientHref}
		<a href={clientHref} class="w-fit text-small font-bold text-accent-ink">Edit di halaman klien</a
		>
	{:else if !compact && !editing}
		<p class="text-small text-ink-3">
			Dipakai Saran AI. Diperbarui otomatis setiap pagi jika ada riwayat baru.
		</p>
	{/if}
</section>
