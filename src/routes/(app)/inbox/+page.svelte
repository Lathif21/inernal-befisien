<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Clock from '@lucide/svelte/icons/clock';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Search from '@lucide/svelte/icons/search';
	import Send from '@lucide/svelte/icons/send';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import ComposeDrawer from '#lib/components/inbox/ComposeDrawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { addressLabel, parseAddress, parseAddressList } from '#lib/email.ts';
	import { sendAtLabel, trashPurgeDate, TRASH_DAYS } from '#lib/email-draft.ts';
	import { forwardSubject } from '#lib/email-forward.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { dateID, dayKeyWib } from '#lib/format.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const FILTERS = [
		{ key: 'all', label: 'Semua' },
		{ key: 'unread', label: 'Belum dibaca' },
		{ key: 'client', label: 'Klien' },
		{ key: 'none', label: 'Tanpa klien' },
		{ key: 'sent', label: 'Terkirim' },
		{ key: 'drafts', label: 'Draf' },
		{ key: 'scheduled', label: 'Terjadwal' },
		{ key: 'trash', label: 'Sampah' }
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
	let emptying = $state(false);

	const view = $derived(data.params.filter);
	const isDraftView = $derived(view === 'drafts' || view === 'scheduled');
	const nothingYet = $derived(!data.params.q && Object.values(data.counts).every((n) => n === 0));

	const today = dayKeyWib();
	/** "10:24" today, "27 Okt" this year, "27 Okt 2025" before (WIB) */
	function when(d: Date) {
		const day = dayKeyWib(d);
		if (day === today) return dateID(d, 'time');
		return dateID(d, day.slice(0, 4) === today.slice(0, 4) ? 'day' : 'date');
	}

	type ThreadRow = NonNullable<typeof data.list>['rows'][number];

	/** Incoming: the sender; outgoing: "Ke: …" the first recipient */
	function who(row: ThreadRow) {
		const m = row.last;
		if (m.direction === 'in') return addressLabel({ name: m.fromName, email: m.fromEmail });
		const first = m.to[0] ? parseAddress(m.to[0]) : null;
		return `Ke: ${first ? addressLabel(first) : '–'}`;
	}

	/** A draft's first recipient as typed */
	function draftTo(raw: string) {
		const first = parseAddressList(raw).addresses[0];
		return first ? `Ke: ${addressLabel(first)}` : '(belum ada penerima)';
	}

	async function opened(threadId: string) {
		await goto(resolve('/(app)/inbox/[id]', { id: threadId }));
	}

	// A draft opened from Draf (?draft=…); closing it drops the parameter
	let draftOpen = $state(false);
	let openedDraft = '';
	$effect(() => {
		const id = data.draft?.id ?? '';
		if (id && id !== openedDraft) draftOpen = true;
		openedDraft = id;
	});
	const draftDescription = $derived(
		data.draft?.forward
			? `Meneruskan email dari ${addressLabel({ name: data.draft.forward.fromName, email: data.draft.forward.fromEmail })}`
			: data.draft?.threadId
				? `Membalas: ${data.draft.subject || '(tanpa subjek)'}`
				: undefined
	);
	function closeDraft() {
		if (page.url.searchParams.has('draft'))
			void goto(href({ draft: undefined }), { replace: true });
	}
</script>

<Topbar title="Email">
	{#snippet actions()}
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => (composing = true)}>
			<PenLine size={18} strokeWidth={2} />
			Tulis email
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	{#if nothingYet}
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
			{#if !isDraftView}
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
			{/if}
			<nav class="flex flex-wrap gap-2" aria-label="Filter email">
				{#each FILTERS as f (f.key)}
					{@const active = view === f.key}
					<a
						href={href({ filter: f.key, draft: undefined })}
						class={['bf-chip px-3! py-1.5!', active && 'bg-navy! text-on-accent!']}
						aria-current={active ? 'page' : undefined}
						data-sveltekit-replacestate
						data-sveltekit-noscroll>{f.label} · {data.counts[f.key]}</a
					>
				{/each}
			</nav>

			{#if view === 'trash' && data.counts.trash > 0}
				<div
					class="flex flex-wrap items-center gap-3 rounded-control bg-tint-2 px-4 py-3 text-small text-ink-2"
				>
					<p class="min-w-0 flex-1">
						Percakapan di Sampah dihapus permanen setelah {TRASH_DAYS} hari. Timeline klien tetap mencatatnya.
					</p>
					<button
						type="button"
						class="bf-btn bf-btn--secondary bf-btn--sm"
						onclick={() => (emptying = true)}
					>
						<Trash2 size={14} strokeWidth={2} />
						Kosongkan Sampah
					</button>
				</div>
			{/if}

			{#if isDraftView}
				{#if data.drafts.length === 0}
					<p
						class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2"
					>
						{view === 'drafts'
							? 'Belum ada draf. Email yang sedang ditulis tersimpan otomatis di sini.'
							: 'Tidak ada email terjadwal.'}
					</p>
				{:else}
					<ul class="flex min-w-0 flex-col">
						{#each data.drafts as d (d.id)}
							<li
								class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-tint-2 py-1 first:border-t-0"
							>
								{#snippet summary()}
									<Avatar name={draftTo(d.to).replace(/^Ke: /, '')} size={36} tone="dark" />
									<div class="min-w-0 flex-1">
										<p class="flex min-w-0 items-baseline gap-2">
											<span class="min-w-0 truncate text-body font-semibold text-ink-2"
												>{draftTo(d.to)}</span
											>
											{#if d.status === 'draft'}
												<span class="bf-chip bf-chip--danger shrink-0">Draf</span>
											{:else if d.status === 'failed'}
												<span class="bf-chip bf-chip--danger shrink-0">Gagal</span>
											{:else if d.status === 'sending'}
												<span class="bf-chip bf-chip--warning shrink-0">Mengirim…</span>
											{/if}
											<span class="flex-1"></span>
											{#if d.files > 0}
												<Paperclip
													size={14}
													strokeWidth={2}
													class="shrink-0 text-ink-3"
													aria-label="Ada lampiran"
												/>
											{/if}
											{#if d.status === 'draft'}
												<time
													class="shrink-0 font-mono text-[12px] font-medium text-ink-3"
													datetime={new Date(d.updatedAt).toISOString()}
													>{when(new Date(d.updatedAt))}</time
												>
											{/if}
										</p>
										<p class="truncate text-body font-semibold text-ink">
											{d.subject || (d.forwardEmailId ? 'Teruskan email' : '(tanpa subjek)')}
										</p>
										{#if d.status !== 'draft' && d.scheduledAt}
											<p class="flex items-center gap-1.5 text-small font-bold text-accent-ink">
												<Clock size={14} strokeWidth={2} aria-hidden="true" />
												{d.status === 'failed' ? 'Dijadwalkan' : 'Dikirim'}
												{sendAtLabel(d.scheduledAt)} WIB
											</p>
										{/if}
										{#if d.status === 'failed' && d.error}
											<p class="text-small font-semibold text-danger">{d.error}</p>
										{:else}
											<p class="truncate text-small text-ink-3">{d.snippet}</p>
										{/if}
									</div>
								{/snippet}
								{#if d.status === 'draft'}
									<a
										href={href({ draft: d.id })}
										class="flex min-w-0 flex-1 basis-64 gap-3 rounded-control px-2 py-2 hover:bg-tint-2"
										data-sveltekit-noscroll
									>
										{@render summary()}
									</a>
									<form method="post" action="?/deleteDraft" use:enhance={refreshThenToast()}>
										<input type="hidden" name="draftId" value={d.id} />
										<button
											type="submit"
											class="bf-icon-btn"
											aria-label="Buang draf {d.subject || '(tanpa subjek)'}"
											title="Buang draf"
										>
											<Trash2 size={16} strokeWidth={1.75} />
										</button>
									</form>
								{:else}
									<div class="flex min-w-0 flex-1 basis-64 gap-3 px-2 py-2">
										{@render summary()}
									</div>
									{#if d.status !== 'sending'}
										<div class="flex flex-wrap justify-end gap-2 pb-2 pl-14 sm:pb-0 sm:pl-0">
											<form
												method="post"
												action="?/unschedule"
												use:enhance={() =>
													async ({ result }) => {
														if (result.type === 'success')
															await goto(href({ filter: 'drafts', draft: d.id }));
														else if (result.type === 'failure')
															toast.error(String(result.data?.error));
													}}
											>
												<input type="hidden" name="draftId" value={d.id} />
												<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm"
													>Ubah</button
												>
											</form>
											{#if d.status === 'scheduled'}
												<form method="post" action="?/unschedule" use:enhance={refreshThenToast()}>
													<input type="hidden" name="draftId" value={d.id} />
													<button type="submit" class="bf-btn bf-btn--ghost bf-btn--sm"
														>Batalkan jadwal</button
													>
												</form>
											{/if}
											<form method="post" action="?/sendNow" use:enhance={refreshThenToast()}>
												<input type="hidden" name="draftId" value={d.id} />
												<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm">
													<Send size={14} strokeWidth={2} />
													Kirim sekarang
												</button>
											</form>
										</div>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{:else if !data.list || data.list.rows.length === 0}
				<p
					class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2"
				>
					{view === 'trash' && !data.params.q
						? 'Sampah kosong.'
						: 'Tidak ada email yang cocok dengan filter.'}
				</p>
			{:else}
				<ul class="flex min-w-0 flex-col">
					{#each data.list.rows as row (row.threadId)}
						{@const unread = row.unread > 0}
						<li class="flex min-w-0 items-center gap-1 border-t border-tint-2 first:border-t-0">
							<a
								href={resolve('/(app)/inbox/[id]', { id: row.threadId })}
								class={[
									'flex min-w-0 flex-1 gap-3 rounded-control px-2 py-3 hover:bg-tint-2',
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
										{#if row.deletedAt}
											<span class="shrink-0"
												>Dihapus permanen {dateID(trashPurgeDate(row.deletedAt), 'day')} ·</span
											>
										{/if}
										<span class="min-w-0 truncate">{row.last.snippet}</span>
									</p>
								</div>
							</a>
							<form
								method="post"
								action={row.deletedAt ? '?/restore' : '?/trash'}
								use:enhance={refreshThenToast()}
							>
								<input type="hidden" name="threadId" value={row.threadId} />
								<button
									type="submit"
									class="bf-icon-btn border-0! bg-transparent!"
									aria-label="{row.deletedAt ? 'Pulihkan' : 'Hapus'} percakapan {row.last.subject ||
										'(tanpa subjek)'}"
									title={row.deletedAt ? 'Pulihkan' : 'Hapus'}
								>
									{#if row.deletedAt}
										<RotateCcw size={16} strokeWidth={1.75} />
									{:else}
										<Trash2 size={16} strokeWidth={1.75} />
									{/if}
								</button>
							</form>
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
	signature={data.signature}
	canSchedule={data.canSchedule}
	onsent={async (threadId) => {
		await invalidateAll();
		await opened(threadId);
	}}
	onscheduled={() => goto(href({ filter: 'scheduled', draft: undefined }))}
	onchanged={() => invalidateAll()}
/>

{#key data.draft?.id}
	{#if data.draft}
		<ComposeDrawer
			bind:open={
				() => draftOpen,
				(v) => {
					draftOpen = v;
					if (!v) closeDraft();
				}
			}
			draft={data.draft}
			threadId={data.draft.threadId ?? ''}
			to={data.draft.to}
			cc={data.draft.cc}
			subject={data.draft.subject ||
				(data.draft.forward ? forwardSubject(data.draft.forward.subject) : '')}
			description={draftDescription}
			signature={data.signature}
			canSchedule={data.canSchedule}
			forward={data.draft.forward
				? {
						emailId: data.draft.forward.id,
						attachments: data.draft.forward.attachments,
						expired: data.draft.forward.expired
					}
				: null}
			onsent={async (threadId) => {
				await invalidateAll();
				await opened(threadId);
			}}
			onscheduled={() => goto(href({ filter: 'scheduled', draft: undefined }))}
			onchanged={() => invalidateAll()}
		/>
	{/if}
{/key}

<ConfirmDialog
	bind:open={emptying}
	title="Kosongkan Sampah?"
	action="?/emptyTrash"
	fields={{}}
	confirmLabel="Hapus permanen"
	tone="danger"
>
	{data.counts.trash} percakapan di Sampah akan <b>dihapus permanen</b> dan tidak bisa dipulihkan.
</ConfirmDialog>
