<script lang="ts">
	import { enhance as kitEnhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import ClientFormDrawer from '#lib/components/clients/ClientFormDrawer.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		CLIENT_STATUS_LABELS,
		CLIENT_STATUSES,
		INDUSTRIES,
		INDUSTRY_LABELS,
		type ClientStatus
	} from '#lib/constants.ts';
	import { rupiah } from '#lib/format.ts';
	import type { ClientRow, ClientSort } from '#lib/server/services/clients.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ---------- create / edit drawer ----------
	let clientDrawer: ReturnType<typeof ClientFormDrawer> | undefined = $state();
	const openCreate = () => clientDrawer?.openCreate();
	const openEdit = (row: ClientRow) => clientDrawer?.openEdit(row);

	// ---------- archive confirmation ----------
	let archiveTarget = $state<ClientRow | null>(null);
	let archiveOpen = $state(false);
	function askArchive(row: ClientRow) {
		archiveTarget = row;
		archiveOpen = true;
	}

	// ---------- filters (GET params; plain form submit works without JS) ----------
	const params = $derived(data.params);
	const hasFilters = $derived(
		Boolean(params.q || params.status || params.industry || params.owner)
	);
	let q = $state(page.url.searchParams.get('q') ?? '');
	let searchEl: HTMLInputElement | undefined = $state();
	let filterForm: HTMLFormElement | undefined = $state();
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	// Follow back / forward navigation unless the person is typing
	$effect(() => {
		const external = params.q ?? '';
		if (document.activeElement !== searchEl) q = external;
	});

	/** Query string from key/value pairs, dropping empty values (keeps URLs clean) */
	function toQuery(pairs: Iterable<[string, FormDataEntryValue | undefined]>) {
		const kept = [...pairs].filter(
			(p): p is [string, string] => typeof p[1] === 'string' && !!p[1]
		);
		return kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
	}

	function listHref(qs: string) {
		return qs ? resolve(`clients?${qs}`) : resolve('clients');
	}

	function submitFilters(e?: SubmitEvent) {
		e?.preventDefault();
		if (!filterForm) return;
		goto(listHref(toQuery(new FormData(filterForm))), { replace: true, reset: false });
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => submitFilters(), 300);
	}

	/** Current URL with some params changed (undefined removes one) */
	function withParams(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), ...changes };
		return listHref(toQuery(Object.entries(merged)));
	}

	const sort = $derived(params.sort ?? 'name');
	const dir = $derived(params.dir ?? 'asc');
	function sortHref(key: ClientSort) {
		const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
		return withParams({ sort: key, dir: nextDir, page: undefined });
	}

	const STATUS_CHIP: Record<ClientStatus, string> = {
		prospect: 'bf-chip bf-chip--service',
		active: 'bf-chip bf-chip--success',
		inactive: 'bf-chip',
		archived: 'bf-chip bf-chip--planned'
	};

	const columns: { key: ClientSort; label: string; num?: boolean }[] = [
		{ key: 'name', label: 'Klien' },
		{ key: 'industry', label: 'Industri' },
		{ key: 'status', label: 'Status' }
	];
	const numColumns: { key: ClientSort; label: string }[] = [
		{ key: 'openDeals', label: 'Deal terbuka' },
		{ key: 'activeProjects', label: 'Proyek aktif' },
		{ key: 'profit', label: 'Laba tahun ini' }
	];
</script>

<Topbar title="Klien">
	{#snippet actions()}
		<button type="button" class="bf-btn bf-btn--primary" onclick={openCreate}>
			<Plus size={18} strokeWidth={2} />
			Tambah klien
		</button>
	{/snippet}
</Topbar>

{#snippet sortHeader(key: ClientSort, label: string, num = false)}
	<th
		scope="col"
		class={num ? 'num' : undefined}
		aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
	>
		<a
			href={sortHref(key)}
			class="inline-flex items-center gap-1 text-ink-2 no-underline hover:text-ink"
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			{label}
			{#if sort === key}
				{#if dir === 'asc'}<ArrowUp size={13} strokeWidth={2.4} />{:else}<ArrowDown
						size={13}
						strokeWidth={2.4}
					/>{/if}
			{/if}
		</a>
	</th>
{/snippet}

<main class="page-body">
	{#if data.list.total === 0 && !hasFilters}
		<EmptyState
			illustration="agent"
			message="Belum ada klien. Tambahkan klien pertama untuk mulai mencatat deal, proyek, dan keuangannya."
		>
			{#snippet action()}
				<button type="button" class="bf-btn bf-btn--primary" onclick={openCreate}>
					<Plus size={18} strokeWidth={2} />
					Tambah klien
				</button>
			{/snippet}
		</EmptyState>
	{:else}
		<section
			class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-4 sm:p-5"
			aria-label="Daftar klien"
		>
			<form
				method="get"
				role="search"
				class="flex flex-wrap items-end gap-3"
				bind:this={filterForm}
				onsubmit={submitFilters}
			>
				<label class="bf-search min-w-0 flex-[1_1_260px]">
					<Search size={16} strokeWidth={2} aria-hidden="true" />
					<input
						type="search"
						name="q"
						bind:value={q}
						bind:this={searchEl}
						oninput={onSearchInput}
						placeholder="Cari nama klien, kota, atau kontak"
						aria-label="Cari klien"
						maxlength="100"
					/>
				</label>
				<div class="bf-field min-w-0 flex-[1_1_150px]">
					<label for="filter-status">Status</label>
					<select
						id="filter-status"
						name="status"
						value={params.status ?? ''}
						onchange={() => submitFilters()}
					>
						<option value="">Semua (tanpa arsip)</option>
						{#each CLIENT_STATUSES as s (s)}<option value={s}>{CLIENT_STATUS_LABELS[s]}</option
							>{/each}
					</select>
				</div>
				<div class="bf-field min-w-0 flex-[1_1_150px]">
					<label for="filter-industry">Industri</label>
					<select
						id="filter-industry"
						name="industry"
						value={params.industry ?? ''}
						onchange={() => submitFilters()}
					>
						<option value="">Semua industri</option>
						{#each INDUSTRIES as ind (ind)}<option value={ind}>{INDUSTRY_LABELS[ind]}</option
							>{/each}
					</select>
				</div>
				<div class="bf-field min-w-0 flex-[1_1_150px]">
					<label for="filter-owner">Pemilik</label>
					<select
						id="filter-owner"
						name="owner"
						value={params.owner ?? ''}
						onchange={() => submitFilters()}
					>
						<option value="">Semua pemilik</option>
						{#each data.owners as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				</div>
				{#if params.sort}<input type="hidden" name="sort" value={params.sort} />{/if}
				{#if params.dir}<input type="hidden" name="dir" value={params.dir} />{/if}
				<noscript><button type="submit" class="bf-btn bf-btn--secondary">Terapkan</button></noscript
				>
			</form>

			<p class="text-small text-ink-2" aria-live="polite">
				{data.list.total} klien{hasFilters ? ' cocok dengan filter' : ''}
				{#if hasFilters}
					· <a
						href={resolve('clients')}
						class="font-bold text-accent-ink"
						onclick={() => (q = '')}
						data-sveltekit-replacestate>Hapus filter</a
					>
				{/if}
			</p>

			{#if data.list.rows.length === 0}
				<p
					class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2"
				>
					Tidak ada klien yang cocok dengan filter.
				</p>
			{:else}
				<div class="bf-table-wrap min-w-0">
					<table class="bf-table min-w-240">
						<thead>
							<tr>
								{#each columns as c (c.key)}{@render sortHeader(c.key, c.label)}{/each}
								<th scope="col">Kontak utama</th>
								{#each numColumns as c (c.key)}{@render sortHeader(c.key, c.label, true)}{/each}
								<th scope="col">Pemilik</th>
								<th scope="col"><span class="sr-only">Aksi</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.list.rows as row (row.id)}
								<tr>
									<td class="max-w-64">
										<a
											href={resolve('/(app)/clients/[id]', { id: row.id })}
											class="block max-w-full truncate font-bold text-ink no-underline hover:text-accent-ink"
										>
											{row.name}
										</a>
										{#if row.city}<span class="block text-small text-ink-3">{row.city}</span>{/if}
									</td>
									<td>{row.industry ? INDUSTRY_LABELS[row.industry] : '–'}</td>
									<td
										><span class={STATUS_CHIP[row.status]}>{CLIENT_STATUS_LABELS[row.status]}</span
										></td
									>
									<td>
										{#if row.contactName}
											<span class="inline-flex items-center gap-2">
												<span class="max-w-40 truncate">{row.contactName}</span>
												{#if row.contactPhone}
													<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external WhatsApp link -->
													<a
														href="https://wa.me/{row.contactPhone}"
														target="_blank"
														rel="noopener noreferrer"
														class="bf-icon-btn size-8! text-success-fill"
														aria-label="WhatsApp {row.contactName}"
													>
														<MessageCircle size={15} strokeWidth={2} />
													</a>
												{/if}
											</span>
										{:else}<span class="text-ink-3">–</span>{/if}
									</td>
									<td class="num">{row.openDeals}</td>
									<td class="num">{row.activeProjects}</td>
									<td
										class={[
											'num',
											row.profitYtd > 0 && 'text-success',
											row.profitYtd < 0 && 'text-danger',
											row.profitYtd === 0 && 'text-ink-3'
										]}>{rupiah(row.profitYtd)}</td
									>
									<td>
										{#if row.ownerName}
											<span class="inline-flex items-center gap-2">
												<Avatar name={row.ownerName} size={26} />
												<span class="max-w-32 truncate">{row.ownerName}</span>
											</span>
										{:else}<span class="text-ink-3">–</span>{/if}
									</td>
									<td>
										<div class="flex justify-end gap-1.5">
											{#if row.archivedAt}
												<form method="post" action="?/restore" use:kitEnhance={refreshThenToast()}>
													<input type="hidden" name="id" value={row.id} />
													<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm">
														<ArchiveRestore size={15} strokeWidth={1.75} />
														Pulihkan
													</button>
												</form>
											{:else}
												<button
													type="button"
													class="bf-icon-btn"
													aria-label="Edit {row.name}"
													onclick={() => openEdit(row)}
												>
													<Pencil size={15} strokeWidth={1.75} />
												</button>
												<button
													type="button"
													class="bf-icon-btn"
													aria-label="Arsipkan {row.name}"
													onclick={() => askArchive(row)}
												>
													<Archive size={15} strokeWidth={1.75} />
												</button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<Pager
				page={data.list.page}
				total={data.list.total}
				pageSize={data.list.pageSize}
				noun="klien"
				href={(n) => withParams({ page: n > 1 ? String(n) : undefined })}
			/>
		</section>
	{/if}
</main>

<ClientFormDrawer bind:this={clientDrawer} form={data.form} owners={data.owners} />

<ConfirmDialog
	bind:open={archiveOpen}
	title="Arsipkan klien?"
	action="?/archive"
	fields={{ id: archiveTarget?.id ?? '' }}
	confirmLabel="Arsipkan"
>
	<b class="text-ink">{archiveTarget?.name}</b> tidak tampil lagi di daftar dan board. Datanya tetap tersimpan
	dan bisa dipulihkan dari filter Status → Diarsipkan.
</ConfirmDialog>
