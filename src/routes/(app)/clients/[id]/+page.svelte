<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance as kitEnhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { superForm } from 'sveltekit-superforms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Globe from '@lucide/svelte/icons/globe';
	import Mail from '@lucide/svelte/icons/mail';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Send from '@lucide/svelte/icons/send';
	import Star from '@lucide/svelte/icons/star';
	import Trash from '@lucide/svelte/icons/trash-2';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import ClientFormDrawer from '#lib/components/clients/ClientFormDrawer.svelte';
	import Timeline from '#lib/components/clients/Timeline.svelte';
	import Field from '#lib/components/form/Field.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		ACTIVITY_TYPE_LABELS,
		CLIENT_SOURCE_LABELS,
		CLIENT_STATUS_LABELS,
		DEAL_STAGE_META,
		INDUSTRY_LABELS,
		MANUAL_ACTIVITY_TYPES,
		PROJECT_STAGE_META,
		SERVICE_TYPE_LABELS,
		type ClientStatus
	} from '#lib/constants.ts';
	import { dateID, dateToWibLocal, phoneDisplay, rupiah } from '#lib/format.ts';
	import type { ContactRow } from '#lib/server/services/contacts.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const c = $derived(data.client);
	const archived = $derived(!!c.archivedAt);
	const primary = $derived(data.contacts.find((x) => x.isPrimary));

	const TABS = [
		{ key: 'ringkasan', label: 'Ringkasan' },
		{ key: 'kontak', label: 'Kontak' },
		{ key: 'deal', label: 'Deal & Proyek' },
		{ key: 'aktivitas', label: 'Aktivitas' }
	] as const;
	const tabHref = (tab: string, page?: number) =>
		resolve(`/(app)/clients/[id]?tab=${tab}${page && page > 1 ? `&page=${page}` : ''}`, {
			id: c.id
		});

	const STATUS_CHIP: Record<ClientStatus, string> = {
		prospect: 'bf-chip bf-chip--service',
		active: 'bf-chip bf-chip--success',
		inactive: 'bf-chip',
		archived: 'bf-chip bf-chip--planned'
	};

	// ---------- client edit drawer ----------
	let clientDrawer: ReturnType<typeof ClientFormDrawer> | undefined = $state();

	// ---------- contacts ----------
	let contactOpen = $state(false);
	let contactEditing = $state<string | null>(null);
	let contactToDelete = $state<ContactRow | null>(null);
	let deleteOpen = $state(false);

	const contactForm = superForm(
		untrack(() => data.contactForm),
		{
			id: 'contact-form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					contactOpen = false;
					toast.success(form.message.text);
				}
			}
		}
	);
	const {
		form: cForm,
		errors: cErrors,
		enhance: cEnhance,
		submitting: cSubmitting,
		message: cMessage
	} = contactForm;

	function newContact() {
		contactEditing = null;
		// the first contact is always primary; the service enforces it too
		contactForm.reset({ data: { isPrimary: data.contacts.length === 0 } });
		contactOpen = true;
	}

	function editContact(row: ContactRow) {
		contactEditing = row.name;
		contactForm.reset({
			data: {
				id: row.id,
				name: row.name,
				position: row.position ?? '',
				phone: row.phone ?? '',
				email: row.email ?? '',
				isPrimary: row.isPrimary
			}
		});
		contactOpen = true;
	}

	function askDelete(row: ContactRow) {
		contactToDelete = row;
		deleteOpen = true;
	}

	// ---------- activity composer ----------
	const {
		form: nForm,
		errors: nErrors,
		enhance: nEnhance,
		submitting: nSubmitting
	} = superForm(
		untrack(() => data.noteForm),
		{
			id: 'note-form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') toast.success(form.message.text);
				if (form.message?.type === 'error') toast.error(form.message.text);
			}
		}
	);
	// Latest allowed value for the back-dating picker (WIB)
	const nowLocal = dateToWibLocal();

	const openDeals = $derived(data.deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost'));
	const activeProjects = $derived(data.projects.filter((p) => p.stage !== 'done'));
</script>

<Topbar title={c.name}>
	{#snippet actions()}
		<button
			type="button"
			class="bf-btn bf-btn--secondary"
			onclick={() => clientDrawer?.openEdit(c)}
			disabled={archived}
		>
			<Pencil size={16} strokeWidth={1.75} />
			Edit klien
		</button>
	{/snippet}
</Topbar>

<main class="page-body">
	<a
		href={resolve('clients')}
		class="inline-flex w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Semua klien
	</a>

	{#if archived}
		<p role="status" class="rounded-control bg-tint px-4 py-3 text-small font-bold text-ink-2">
			Klien ini diarsipkan pada {dateID(c.archivedAt!)}. Pulihkan dari daftar klien (filter Status →
			Diarsipkan) untuk mengubah datanya.
		</p>
	{/if}

	<!-- Header card -->
	<section
		class="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-card bg-surface p-5"
		aria-label="Ringkasan klien"
	>
		<div class="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<span class={STATUS_CHIP[c.status]}>{CLIENT_STATUS_LABELS[c.status]}</span>
				{#if c.industry}<span class="bf-chip">{INDUSTRY_LABELS[c.industry]}</span>{/if}
				{#if c.source}<span class="bf-chip">Sumber: {CLIENT_SOURCE_LABELS[c.source]}</span>{/if}
			</div>
			<p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-2">
				{#if c.city}
					<span class="inline-flex items-center gap-1"
						><MapPin size={14} strokeWidth={1.9} />{c.city}</span
					>
				{/if}
				{#if c.ownerName}
					<span class="inline-flex items-center gap-1.5"
						><Avatar name={c.ownerName} size={22} /> Pemilik: {c.ownerName}</span
					>
				{/if}
				<span>{c.openDeals} deal terbuka · {c.activeProjects} proyek aktif</span>
			</p>
		</div>

		<div class="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
			<span class="text-small font-bold text-ink-2">Kontak utama</span>
			{#if primary}
				<div class="flex flex-wrap items-center gap-3">
					<div class="min-w-0">
						<p class="truncate font-bold">{primary.name}</p>
						{#if primary.position}<p class="truncate text-small text-ink-3">
								{primary.position}
							</p>{/if}
					</div>
					<div class="ml-auto flex gap-2">
						{#if primary.phone}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external WhatsApp link -->
							<a
								href="https://wa.me/{primary.phone}"
								target="_blank"
								rel="noopener noreferrer"
								class="bf-btn bf-btn--sm bg-success-fill text-on-accent"
							>
								<MessageCircle size={15} strokeWidth={2} />
								WhatsApp
							</a>
						{/if}
						{#if primary.email}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto link -->
							<a href="mailto:{primary.email}" class="bf-btn bf-btn--secondary bf-btn--sm">
								<Mail size={15} strokeWidth={1.9} />
								Email
							</a>
						{/if}
					</div>
				</div>
			{:else}
				<p class="text-small text-ink-3">
					Belum ada kontak.
					{#if !archived}<a href={tabHref('kontak')} class="font-bold text-accent-ink"
							>Tambah kontak</a
						>{/if}
				</p>
			{/if}
		</div>
	</section>

	<nav class="bf-seg w-fit max-w-full overflow-x-auto" aria-label="Bagian klien">
		{#each TABS as t (t.key)}
			<a
				href={tabHref(t.key)}
				aria-current={data.tab === t.key ? 'page' : undefined}
				data-sveltekit-noscroll
				data-sveltekit-replacestate>{t.label}</a
			>
		{/each}
	</nav>

	{#if data.tab === 'ringkasan'}
		<div class="grid gap-6 lg:grid-cols-3">
			<div class="flex flex-col gap-6 lg:col-span-2">
				<section class="flex flex-col gap-4 rounded-card bg-surface p-5">
					<h2 class="text-section-title">Data klien</h2>
					<dl class="grid gap-x-6 gap-y-3 text-body sm:grid-cols-2">
						<div>
							<dt class="text-small font-bold text-ink-2">Alamat</dt>
							<dd class="whitespace-pre-line">{c.address ?? '–'}</dd>
						</div>
						<div>
							<dt class="text-small font-bold text-ink-2">Website</dt>
							<dd>
								{#if c.website}
									<!-- eslint-disable svelte/no-navigation-without-resolve -- the client's own website (always http/https, see schemas/client.ts) -->
									<a
										href={c.website}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1 font-bold text-accent-ink"
										><Globe size={14} strokeWidth={1.9} />{c.website.replace(/^https?:\/\//, '')}</a
									>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{:else}–{/if}
							</dd>
						</div>
						<div>
							<dt class="text-small font-bold text-ink-2">NPWP</dt>
							<dd class="font-mono text-[13px]">{c.npwp ?? '–'}</dd>
						</div>
						<div>
							<dt class="text-small font-bold text-ink-2">Klien sejak</dt>
							<dd>{dateID(c.createdAt)}</dd>
						</div>
						<div class="sm:col-span-2">
							<dt class="text-small font-bold text-ink-2">Catatan</dt>
							<dd class="whitespace-pre-line">{c.notes ?? '–'}</dd>
						</div>
					</dl>
				</section>

				<section class="flex flex-col gap-3 rounded-card bg-surface p-5">
					<div class="flex items-center justify-between gap-2">
						<h2 class="text-section-title">Deal & proyek berjalan</h2>
						<a href={tabHref('deal')} class="bf-btn bf-btn--ghost bf-btn--sm">Lihat semua</a>
					</div>
					{#if openDeals.length === 0 && activeProjects.length === 0}
						<p class="text-body text-ink-3">Tidak ada deal terbuka atau proyek aktif.</p>
					{:else}
						<ul class="flex flex-col gap-2">
							{#each openDeals as d (d.id)}
								<li
									class="flex flex-wrap items-center gap-2 rounded-kanban border border-line px-3 py-2.5"
								>
									<span class="text-small font-bold text-ink-3">Deal</span>
									<span class="min-w-0 flex-1 truncate font-bold">{d.title}</span>
									<span class={['bf-chip', DEAL_STAGE_META[d.stage].chip]}
										>{DEAL_STAGE_META[d.stage].label}</span
									>
									{#if d.valueEstimate}<span class="text-small font-bold"
											>{rupiah(d.valueEstimate)}</span
										>{/if}
								</li>
							{/each}
							{#each activeProjects as p (p.id)}
								<li
									class="flex flex-wrap items-center gap-2 rounded-kanban border border-line px-3 py-2.5"
								>
									<span class="text-small font-bold text-ink-3">Proyek</span>
									<span class="min-w-0 flex-1 truncate font-bold">{p.name}</span>
									<span class={['bf-chip', PROJECT_STAGE_META[p.stage].chip]}
										>{PROJECT_STAGE_META[p.stage].label}</span
									>
									{#if p.contractValue}<span class="text-small font-bold"
											>{rupiah(p.contractValue)}</span
										>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</div>

			<section class="flex flex-col gap-3 rounded-card bg-surface p-5">
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-section-title">Aktivitas terbaru</h2>
					<a href={tabHref('aktivitas')} class="bf-btn bf-btn--ghost bf-btn--sm">Lihat semua</a>
				</div>
				<Timeline entries={data.activities.rows} />
			</section>
		</div>
	{:else if data.tab === 'kontak'}
		<section class="flex flex-col gap-4 rounded-card bg-surface p-5" aria-label="Kontak">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-section-title">Kontak ({data.contacts.length})</h2>
				{#if !archived}
					<button type="button" class="bf-btn bf-btn--primary" onclick={newContact}>
						<UserPlus size={17} strokeWidth={1.9} />
						Tambah kontak
					</button>
				{/if}
			</div>
			{#if data.contacts.length === 0}
				<p
					class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2"
				>
					Belum ada kontak. Kontak pertama otomatis menjadi kontak utama.
				</p>
			{:else}
				<ul class="grid gap-3 md:grid-cols-2">
					{#each data.contacts as ct (ct.id)}
						<li class="flex flex-col gap-3 rounded-kanban border border-line p-4">
							<div class="flex items-start gap-3">
								<Avatar name={ct.name} size={36} tone={ct.isPrimary ? 'accent' : 'dark'} />
								<div class="min-w-0 flex-1">
									<p class="flex flex-wrap items-center gap-2 font-bold">
										<span class="truncate">{ct.name}</span>
										{#if ct.isPrimary}<span class="bf-chip bf-chip--accent">Utama</span>{/if}
									</p>
									<p class="text-small text-ink-3">{ct.position ?? 'Jabatan belum diisi'}</p>
								</div>
							</div>
							<dl class="flex flex-col gap-1 text-small">
								<div class="flex gap-2">
									<dt class="w-20 shrink-0 font-bold text-ink-2">WhatsApp</dt>
									<dd class="font-mono text-[13px]">{ct.phone ? phoneDisplay(ct.phone) : '–'}</dd>
								</div>
								<div class="flex gap-2">
									<dt class="w-20 shrink-0 font-bold text-ink-2">Email</dt>
									<dd class="min-w-0 truncate">{ct.email ?? '–'}</dd>
								</div>
							</dl>
							<div class="mt-auto flex flex-wrap gap-2">
								{#if ct.phone}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external WhatsApp link -->
									<a
										href="https://wa.me/{ct.phone}"
										target="_blank"
										rel="noopener noreferrer"
										class="bf-btn bf-btn--sm bg-success-fill text-on-accent"
										aria-label="WhatsApp {ct.name}"
									>
										<MessageCircle size={15} strokeWidth={2} />
										WhatsApp
									</a>
								{/if}
								{#if ct.email}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto link -->
									<a
										href="mailto:{ct.email}"
										class="bf-btn bf-btn--secondary bf-btn--sm"
										aria-label="Email {ct.name}"
									>
										<Mail size={15} strokeWidth={1.9} />
										Email
									</a>
								{/if}
								{#if !archived}
									<span class="ml-auto flex gap-1.5">
										{#if !ct.isPrimary}
											<form method="post" action="?/setPrimary" use:kitEnhance={refreshThenToast()}>
												<input type="hidden" name="contactId" value={ct.id} />
												<button
													type="submit"
													class="bf-icon-btn"
													aria-label="Jadikan {ct.name} kontak utama"
													title="Jadikan utama"
												>
													<Star size={15} strokeWidth={1.9} />
												</button>
											</form>
										{/if}
										<button
											type="button"
											class="bf-icon-btn"
											aria-label="Edit {ct.name}"
											onclick={() => editContact(ct)}
										>
											<Pencil size={15} strokeWidth={1.75} />
										</button>
										<button
											type="button"
											class="bf-icon-btn"
											aria-label="Hapus {ct.name}"
											onclick={() => askDelete(ct)}
										>
											<Trash size={15} strokeWidth={1.75} />
										</button>
									</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else if data.tab === 'deal'}
		<section class="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5" aria-label="Deal">
			<h2 class="text-section-title">Deal ({data.deals.length})</h2>
			{#if data.deals.length === 0}
				<p class="text-body text-ink-3">Belum ada deal. Deal dibuat dari board Pipeline Sales.</p>
			{:else}
				<div class="bf-table-wrap min-w-0">
					<table class="bf-table min-w-180">
						<thead>
							<tr>
								<th scope="col">Deal</th>
								<th scope="col">Layanan</th>
								<th scope="col">Tahap</th>
								<th scope="col" class="num">Nilai</th>
								<th scope="col">Target closing</th>
								<th scope="col">Di tahap ini sejak</th>
							</tr>
						</thead>
						<tbody>
							{#each data.deals as d (d.id)}
								<tr>
									<td class="font-bold">
										{d.title}
										{#if d.stage === 'lost' && d.lostReason}
											<span class="block text-small font-semibold text-danger"
												>Alasan: {d.lostReason}</span
											>
										{/if}
									</td>
									<td
										>{#if d.serviceType}<span class="bf-chip bf-chip--service"
												>{SERVICE_TYPE_LABELS[d.serviceType]}</span
											>{:else}–{/if}</td
									>
									<td
										><span class={['bf-chip', DEAL_STAGE_META[d.stage].chip]}
											>{DEAL_STAGE_META[d.stage].label}</span
										></td
									>
									<td class="num">{d.valueEstimate ? rupiah(d.valueEstimate) : '–'}</td>
									<td>{d.expectedClose ? dateID(d.expectedClose) : '–'}</td>
									<td>{dateID(d.stageChangedAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5" aria-label="Proyek">
			<h2 class="text-section-title">Proyek ({data.projects.length})</h2>
			{#if data.projects.length === 0}
				<p class="text-body text-ink-3">Belum ada proyek. Proyek dibuat saat deal menang.</p>
			{:else}
				<div class="bf-table-wrap min-w-0">
					<table class="bf-table min-w-180">
						<thead>
							<tr>
								<th scope="col">Proyek</th>
								<th scope="col">Layanan</th>
								<th scope="col">Tahap</th>
								<th scope="col" class="num">Nilai kontrak</th>
								<th scope="col">Mulai</th>
								<th scope="col">Target selesai</th>
							</tr>
						</thead>
						<tbody>
							{#each data.projects as p (p.id)}
								<tr>
									<td class="font-bold">{p.name}</td>
									<td
										>{#if p.serviceType}<span class="bf-chip bf-chip--service"
												>{SERVICE_TYPE_LABELS[p.serviceType]}</span
											>{:else}–{/if}</td
									>
									<td
										><span class={['bf-chip', PROJECT_STAGE_META[p.stage].chip]}
											>{PROJECT_STAGE_META[p.stage].label}</span
										></td
									>
									<td class="num">{p.contractValue ? rupiah(p.contractValue) : '–'}</td>
									<td>{p.startDate ? dateID(p.startDate) : '–'}</td>
									<td>{p.targetEndDate ? dateID(p.targetEndDate) : '–'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{:else}
		<div class="grid gap-6 lg:grid-cols-3">
			<section
				class="flex flex-col gap-4 rounded-card bg-surface p-5 lg:order-last"
				aria-label="Catat aktivitas"
			>
				<h2 class="text-section-title">Catat aktivitas</h2>
				<form method="post" action="?/addNote" use:nEnhance class="flex flex-col gap-4" novalidate>
					<Field label="Jenis" name="type" errors={$nErrors.type}>
						{#snippet children(attrs)}
							<select {...attrs} bind:value={$nForm.type}>
								{#each MANUAL_ACTIVITY_TYPES as t (t)}<option value={t}
										>{ACTIVITY_TYPE_LABELS[t]}</option
									>{/each}
							</select>
						{/snippet}
					</Field>
					<Field label="Isi" name="body" required errors={$nErrors.body}>
						{#snippet children(attrs)}
							<textarea
								{...attrs}
								bind:value={$nForm.body}
								rows="4"
								maxlength="5000"
								placeholder="Contoh: Telepon Pak Budi, minta penawaran ulang minggu depan."
							></textarea>
						{/snippet}
					</Field>
					<Field
						label="Waktu"
						name="occurredAt"
						errors={$nErrors.occurredAt}
						hint="Kosongkan untuk sekarang (WIB)"
					>
						{#snippet children(attrs)}
							<input
								{...attrs}
								type="datetime-local"
								bind:value={$nForm.occurredAt}
								max={nowLocal}
							/>
						{/snippet}
					</Field>
					<button type="submit" class="bf-btn bf-btn--primary" disabled={$nSubmitting}>
						<Send size={16} strokeWidth={1.9} />
						{$nSubmitting ? 'Menyimpan…' : 'Simpan aktivitas'}
					</button>
				</form>
			</section>

			<section
				class="flex flex-col gap-4 rounded-card bg-surface p-5 lg:col-span-2"
				aria-label="Riwayat aktivitas"
			>
				<h2 class="text-section-title">Riwayat ({data.activities.total})</h2>
				<Timeline entries={data.activities.rows} />
				<Pager
					page={data.activities.page}
					total={data.activities.total}
					pageSize={data.activities.pageSize}
					noun="aktivitas"
					href={(n) => tabHref('aktivitas', n)}
				/>
			</section>
		</div>
	{/if}
</main>

<ClientFormDrawer bind:this={clientDrawer} form={data.clientForm} owners={data.owners} />

<Drawer
	bind:open={contactOpen}
	title={contactEditing ? 'Edit kontak' : 'Tambah kontak'}
	description={contactEditing ?? c.name}
>
	<form
		id="contact-form"
		method="post"
		action="?/saveContact"
		use:cEnhance
		class="flex flex-col gap-4"
		novalidate
	>
		<input type="hidden" name="id" bind:value={$cForm.id} />
		{#if $cMessage?.type === 'error'}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{$cMessage.text}
			</p>
		{/if}
		<Field label="Nama" name="name" required errors={$cErrors.name}>
			{#snippet children(attrs)}
				<input {...attrs} bind:value={$cForm.name} autocomplete="name" maxlength="100" />
			{/snippet}
		</Field>
		<Field label="Jabatan" name="position" errors={$cErrors.position}>
			{#snippet children(attrs)}
				<input
					{...attrs}
					bind:value={$cForm.position}
					autocomplete="organization-title"
					maxlength="100"
					placeholder="Direktur Operasional"
				/>
			{/snippet}
		</Field>
		<Field
			label="Nomor WhatsApp"
			name="phone"
			errors={$cErrors.phone}
			hint="Boleh 08…, +62…, atau 62…"
		>
			{#snippet children(attrs)}
				<input
					{...attrs}
					type="tel"
					bind:value={$cForm.phone}
					autocomplete="tel"
					inputmode="tel"
					maxlength="30"
				/>
			{/snippet}
		</Field>
		<Field label="Email" name="email" errors={$cErrors.email}>
			{#snippet children(attrs)}
				<input
					{...attrs}
					type="email"
					bind:value={$cForm.email}
					autocomplete="email"
					maxlength="200"
				/>
			{/snippet}
		</Field>
		<div class="flex flex-col gap-1.5">
			<label class="inline-flex min-h-(--size-touch) items-center gap-2.5 text-body font-semibold">
				<input
					type="checkbox"
					name="isPrimary"
					bind:checked={$cForm.isPrimary}
					class="size-5 accent-(--color-accent)"
				/>
				Kontak utama
			</label>
			{#if $cErrors.isPrimary}<span class="bf-field__error">{$cErrors.isPrimary[0]}</span>{/if}
		</div>
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (contactOpen = false)}
			>Batal</button
		>
		<button
			type="submit"
			form="contact-form"
			class="bf-btn bf-btn--primary"
			disabled={$cSubmitting}
		>
			{$cSubmitting ? 'Menyimpan…' : 'Simpan kontak'}
		</button>
	{/snippet}
</Drawer>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Hapus kontak?"
	action="?/deleteContact"
	fields={{ contactId: contactToDelete?.id ?? '' }}
	confirmLabel="Hapus kontak"
	tone="danger"
>
	<b class="text-ink">{contactToDelete?.name}</b> dihapus dari {c.name}.
	{#if contactToDelete?.isPrimary && data.contacts.length > 1}
		Kontak tertua lainnya otomatis menjadi kontak utama.
	{/if}
</ConfirmDialog>
