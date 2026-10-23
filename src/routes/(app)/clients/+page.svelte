<script lang="ts">
	import { enhance as kitEnhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { AlertDialog } from 'bits-ui';
	import { superForm } from 'sveltekit-superforms';
	import Archive from '@lucide/svelte/icons/archive';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Avatar from '#lib/components/Avatar.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import Field from '#lib/components/form/Field.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		CLIENT_SOURCE_LABELS,
		CLIENT_SOURCES,
		CLIENT_STATUS_LABELS,
		CLIENT_STATUSES,
		INDUSTRIES,
		INDUSTRY_LABELS,
		type ClientStatus
	} from '#lib/constants.ts';
	import { rupiah } from '#lib/format.ts';
	import { EDITABLE_CLIENT_STATUSES } from '#lib/schemas/client.ts';
	import type { ClientRow, ClientSort } from '#lib/server/services/clients.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ---------- create / edit drawer (Superforms) ----------
	let drawerOpen = $state(false);
	let editingName = $state<string | null>(null);

	const { form, errors, enhance, submitting, message, reset } = superForm(
		untrack(() => data.form),
		{
			id: 'client-form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					drawerOpen = false;
					toast.success(form.message.text);
				}
			}
		}
	);

	function openCreate() {
		editingName = null;
		reset();
		drawerOpen = true;
	}

	function openEdit(row: ClientRow) {
		editingName = row.name;
		reset({
			data: {
				id: row.id,
				name: row.name,
				industry: row.industry ?? '',
				source: row.source ?? '',
				status: (EDITABLE_CLIENT_STATUSES as readonly string[]).includes(row.status)
					? (row.status as (typeof EDITABLE_CLIENT_STATUSES)[number])
					: 'inactive',
				city: row.city ?? '',
				address: row.address ?? '',
				website: row.website ?? '',
				npwp: row.npwp ?? '',
				ownerId: row.ownerId ?? '',
				notes: row.notes ?? ''
			}
		});
		drawerOpen = true;
	}

	// ---------- archive confirmation ----------
	let archiveTarget = $state<ClientRow | null>(null);

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
										<button
											type="button"
											class="block max-w-full truncate text-left font-bold text-ink hover:text-accent-ink"
											onclick={() => openEdit(row)}
											disabled={!!row.archivedAt}
										>
											{row.name}
										</button>
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
												<form
													method="post"
													action="?/restore"
													use:kitEnhance={() =>
														async ({ result, update }) => {
															if (result.type === 'success')
																toast.success(String(result.data?.done));
															if (result.type === 'failure')
																toast.error(String(result.data?.error));
															// stay on this URL so search, filters and sort survive (SvelteKit 3 navigates by default)
															await update({ navigate: false });
														}}
												>
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
													onclick={() => (archiveTarget = row)}
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

<Drawer
	bind:open={drawerOpen}
	title={editingName ? 'Edit klien' : 'Tambah klien'}
	description={editingName ?? 'Data perusahaan. Kontak ditambahkan di halaman detail klien.'}
>
	<form
		id="client-form"
		method="post"
		action="?/save"
		use:enhance
		class="flex flex-col gap-4"
		novalidate
	>
		<input type="hidden" name="id" bind:value={$form.id} />

		{#if $message?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$message.text}
			</p>
		{/if}

		<Field label="Nama klien" name="name" required errors={$errors.name}>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={$form.name} autocomplete="organization" maxlength="120" />
			{/snippet}
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Status" name="status" errors={$errors.status}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.status}>
						{#each EDITABLE_CLIENT_STATUSES as s (s)}<option value={s}
								>{CLIENT_STATUS_LABELS[s]}</option
							>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Industri" name="industry" errors={$errors.industry}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.industry}>
						<option value="">Pilih industri</option>
						{#each INDUSTRIES as ind (ind)}<option value={ind}>{INDUSTRY_LABELS[ind]}</option
							>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Sumber" name="source" errors={$errors.source}>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.source}>
						<option value="">Pilih sumber</option>
						{#each CLIENT_SOURCES as s (s)}<option value={s}>{CLIENT_SOURCE_LABELS[s]}</option
							>{/each}
					</select>
				{/snippet}
			</Field>
			<Field label="Pemilik" name="ownerId" errors={$errors.ownerId} hint="Kosong = Anda">
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.ownerId}>
						<option value="">Pilih pemilik</option>
						{#each data.owners as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				{/snippet}
			</Field>
		</div>

		<Field label="Kota" name="city" errors={$errors.city}>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={$form.city} autocomplete="address-level2" maxlength="80" />
			{/snippet}
		</Field>
		<Field label="Alamat" name="address" errors={$errors.address}>
			{#snippet children(attrs)}
				<textarea {...attrs} bind:value={$form.address} rows="2" autocomplete="street-address"
				></textarea>
			{/snippet}
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Website" name="website" errors={$errors.website}>
				{#snippet children(attrs)}
					<input
						{...attrs}
						bind:value={$form.website}
						inputmode="url"
						placeholder="contoh.co.id"
						maxlength="200"
					/>
				{/snippet}
			</Field>
			<Field label="NPWP" name="npwp" errors={$errors.npwp} hint="Untuk invoice (Fase 2)">
				{#snippet children(attrs)}
					<input {...attrs} bind:value={$form.npwp} inputmode="numeric" maxlength="24" />
				{/snippet}
			</Field>
		</div>

		<Field label="Catatan" name="notes" errors={$errors.notes}>
			{#snippet children(attrs)}
				<textarea {...attrs} bind:value={$form.notes} rows="4"></textarea>
			{/snippet}
		</Field>
	</form>

	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (drawerOpen = false)}>
			Batal
		</button>
		<button type="submit" form="client-form" class="bf-btn bf-btn--primary" disabled={$submitting}>
			{$submitting ? 'Menyimpan…' : 'Simpan klien'}
		</button>
	{/snippet}
</Drawer>

<AlertDialog.Root
	open={archiveTarget !== null}
	onOpenChange={(open) => {
		if (!open) archiveTarget = null;
	}}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-40 bg-navy/40" />
		<AlertDialog.Content
			class="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-panel bg-surface p-6 shadow-modal"
		>
			<AlertDialog.Title class="text-section-title">Arsipkan klien?</AlertDialog.Title>
			<AlertDialog.Description class="text-body text-ink-2">
				<b class="text-ink">{archiveTarget?.name}</b> tidak tampil lagi di daftar dan board. Datanya tetap
				tersimpan dan bisa dipulihkan dari filter Status → Diarsipkan.
			</AlertDialog.Description>
			<form
				method="post"
				action="?/archive"
				class="flex justify-end gap-2"
				use:kitEnhance={() =>
					async ({ result, update }) => {
						if (result.type === 'success') toast.success(String(result.data?.done));
						if (result.type === 'failure') toast.error(String(result.data?.error));
						archiveTarget = null;
						// stay on this URL so search, filters and sort survive (SvelteKit 3 navigates by default)
						await update({ navigate: false });
					}}
			>
				<input type="hidden" name="id" value={archiveTarget?.id ?? ''} />
				<AlertDialog.Cancel class="bf-btn bf-btn--secondary">Batal</AlertDialog.Cancel>
				<button type="submit" class="bf-btn bf-btn--dark">
					<Archive size={16} strokeWidth={1.75} />
					Arsipkan
				</button>
			</form>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
