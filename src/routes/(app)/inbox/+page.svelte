<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Search from '@lucide/svelte/icons/search';
	import Avatar from '#lib/components/Avatar.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import ComposeDrawer from '#lib/components/inbox/ComposeDrawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { addressLabel, parseAddress } from '#lib/email.ts';
	import { dateID, dayKeyWib } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const FILTERS = [
		{ key: 'all', label: 'Semua' },
		{ key: 'unread', label: 'Belum dibaca' },
		{ key: 'client', label: 'Klien' },
		{ key: 'none', label: 'Tanpa klien' },
		{ key: 'sent', label: 'Terkirim' }
	] as const;

	function href(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), page: undefined, ...changes };
		const qs = Object.entries(merged)
			.filter(([k, v]) => !!v && !(k === 'filter' && v === 'all'))
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`inbox?${qs}`) : resolve('inbox');
	}

	let q = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	// svelte-ignore state_referenced_locally
	let composing = $state(!!data.params.to);

	const today = dayKeyWib();
	/** "10:24" today, "27 Okt" this year, "27 Okt 2025" before (WIB) */
	function when(d: Date) {
		const day = dayKeyWib(d);
		if (day === today) return dateID(d, 'time');
		return dateID(d, day.slice(0, 4) === today.slice(0, 4) ? 'day' : 'date');
	}

	/** Incoming: the sender; outgoing: "Ke: …" the first recipient */
	function who(row: (typeof data.list.rows)[number]) {
		const m = row.last;
		if (m.direction === 'in') return addressLabel({ name: m.fromName, email: m.fromEmail });
		const first = m.to[0] ? parseAddress(m.to[0]) : null;
		return `Ke: ${first ? addressLabel(first) : '–'}`;
	}

	async function opened(threadId: string) {
		await goto(resolve('/(app)/inbox/[id]', { id: threadId }));
	}
</script>

<Topbar title="Kotak Masuk">
	{#snippet actions()}
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => (composing = true)}>
			<PenLine size={18} strokeWidth={2} />
			Tulis email
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	{#if data.list.counts.all === 0 && !data.params.q}
		<EmptyState
			illustration="integration"
			message="Belum ada email. Email yang masuk ke info@befisien.com akan muncul di sini dan dikirim ke Telegram."
		>
			{#snippet action()}
				<button type="button" class="bf-btn bf-btn--primary" onclick={() => (composing = true)}>
					<PenLine size={18} strokeWidth={2} />
					Tulis email
				</button>
			{/snippet}
		</EmptyState>
	{:else}
		<section
			class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5"
			aria-label="Daftar email"
		>
			<label class="bf-search min-w-0">
				<Search size={16} strokeWidth={2} aria-hidden="true" />
				<input
					type="search"
					bind:value={q}
					oninput={() => {
						clearTimeout(qTimer);
						qTimer = setTimeout(
							() => goto(href({ q: q || undefined }), { replace: true, reset: false }),
							300
						);
					}}
					placeholder="Cari pengirim, subjek atau isi"
					aria-label="Cari email"
					maxlength="100"
				/>
			</label>
			<nav class="flex flex-wrap gap-2" aria-label="Filter email">
				{#each FILTERS as f (f.key)}
					{@const active = data.params.filter === f.key}
					<a
						href={href({ filter: f.key })}
						class={['bf-chip px-3! py-1.5!', active && 'bg-navy! text-on-accent!']}
						aria-current={active ? 'page' : undefined}
						data-sveltekit-replacestate
						data-sveltekit-noscroll>{f.label} · {data.list.counts[f.key]}</a
					>
				{/each}
			</nav>

			{#if data.list.rows.length === 0}
				<p
					class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2"
				>
					Tidak ada email yang cocok dengan filter.
				</p>
			{:else}
				<ul class="flex min-w-0 flex-col">
					{#each data.list.rows as row (row.threadId)}
						{@const unread = row.unread > 0}
						<li class="border-t border-tint-2 first:border-t-0">
							<a
								href={resolve('/(app)/inbox/[id]', { id: row.threadId })}
								class={[
									'flex min-w-0 gap-3 rounded-control px-2 py-3 hover:bg-tint-2',
									unread && 'bg-tint/40'
								]}
							>
								<Avatar name={who(row).replace(/^Ke: /, '')} size={36} />
								<div class="min-w-0 flex-1">
									<p class="flex min-w-0 items-baseline gap-2">
										<span
											class={[
												'min-w-0 truncate text-body',
												unread ? 'font-extrabold text-ink' : 'font-semibold text-ink-2'
											]}>{who(row)}</span
										>
										{#if row.count > 1}<span class="text-small font-bold text-ink-3"
												>{row.count}</span
											>{/if}
										{#if unread}<span class="sr-only">(belum dibaca)</span>{/if}
										<span class="flex-1"></span>
										{#if row.last.hasAttachments}
											<Paperclip
												size={14}
												strokeWidth={2}
												class="shrink-0 text-ink-3"
												aria-label="Ada lampiran"
											/>
										{/if}
										<time
											class={[
												'shrink-0 font-mono text-[12px]',
												unread ? 'font-bold text-accent-ink' : 'font-medium text-ink-3'
											]}
											datetime={row.lastAt.toISOString()}>{when(row.lastAt)}</time
										>
									</p>
									<p
										class={[
											'truncate text-body',
											unread ? 'font-bold text-ink' : 'font-semibold text-ink'
										]}
									>
										{row.last.subject || '(tanpa subjek)'}
									</p>
									<p class="flex min-w-0 items-center gap-2 text-small text-ink-3">
										{#if row.clientName}
											<span class="bf-chip bf-chip--accent shrink-0">{row.clientName}</span>
										{/if}
										<span class="min-w-0 truncate">{row.last.snippet}</span>
									</p>
								</div>
							</a>
						</li>
					{/each}
				</ul>
				{#if data.list.total > data.list.pageSize}
					<Pager
						page={data.list.page}
						total={data.list.total}
						pageSize={data.list.pageSize}
						noun="percakapan"
						href={(n) => href({ page: n > 1 ? String(n) : undefined })}
					/>
				{/if}
			{/if}
		</section>
	{/if}
</main>

<ComposeDrawer
	bind:open={composing}
	to={data.params.to ?? ''}
	onsent={async (threadId) => {
		await invalidateAll();
		await opened(threadId);
	}}
/>
