<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Search from '@lucide/svelte/icons/search';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Timeline from '#lib/components/clients/Timeline.svelte';
	import KanbanBoard, { type KanbanColumn } from '#lib/components/kanban/KanbanBoard.svelte';
	import KanbanCard from '#lib/components/kanban/KanbanCard.svelte';
	import MoveMenu from '#lib/components/kanban/MoveMenu.svelte';
	import NextActionBox from '#lib/components/kanban/NextActionBox.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import PaymentProgress from '#lib/components/projects/PaymentProgress.svelte';
	import ProjectFormDrawer from '#lib/components/projects/ProjectFormDrawer.svelte';
	import AddStepModal from '#lib/components/steps/AddStepModal.svelte';
	import NextStepPrompt from '#lib/components/steps/NextStepPrompt.svelte';
	import StepsPanel, { type PanelStep } from '#lib/components/steps/StepsPanel.svelte';
	import {
		NEXT_PROJECT_STAGE,
		PROJECT_STAGE_META,
		PROJECT_STAGES,
		SERVICE_TYPE_LABELS,
		SERVICE_TYPES,
		type ProjectStage
	} from '#lib/constants.ts';
	import { dateID, dayKeyWib, rupiah, rupiahShort } from '#lib/format.ts';
	import { toLanes, type KanbanMove } from '#lib/kanban.ts';
	import { daysInStage } from '#lib/next-action.ts';
	import { stepFields, type StepValue } from '#lib/step-form.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Project = (typeof data.projects)[number];

	// One clock for every card; refresh each minute so "Hari ini 14:00" turns late on time
	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(t);
	});
	const today = $derived(dayKeyWib(now));

	const columns: KanbanColumn[] = PROJECT_STAGES.map((s) => ({
		key: s,
		label: PROJECT_STAGE_META[s].label,
		dot: PROJECT_STAGE_META[s].dot,
		collapsed: s === 'done',
		note: s === 'done' ? '30 hari terakhir' : undefined
	}));
	const lanes = $derived(toLanes(data.projects, PROJECT_STAGES, (p) => p.stage));
	const running = $derived(data.projects.filter((p) => p.stage !== 'done'));
	const contractTotal = $derived(running.reduce((s, p) => s + (p.contractValue ?? 0), 0));
	const paidTotal = $derived(running.reduce((s, p) => s + p.paid, 0));

	/** Past the target end date while still being built */
	const overdue = (stage: ProjectStage, target: string | null) =>
		!!target && target < today && stage !== 'done' && stage !== 'maintenance';

	// ---------- URL helpers (filters and the drawer live in the query string) ----------
	function query(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`projects?${qs}`) : resolve('projects');
	}
	const go = (changes: Record<string, string | undefined>) =>
		goto(query(changes), { replace: true, reset: false });

	let q = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	const hasFilters = $derived(
		Boolean(data.params.q || data.params.owner || data.params.service || data.params.late)
	);

	// ---------- talking to the form actions from code (board moves, steps) ----------
	async function post(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
		const res = await fetch(`?/${action}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return deserialize(await res.text());
	}

	async function onMove(move: KanbanMove) {
		const result = await post('move', {
			id: move.id,
			to: move.to,
			beforeId: move.beforeId ?? '',
			afterId: move.afterId ?? ''
		});
		if (result.type === 'success') {
			await invalidateAll();
			toast.success(String(result.data?.done ?? 'Tersimpan.'));
			return;
		}
		const msg = result.type === 'failure' ? String(result.data?.error ?? '') : '';
		throw new Error(msg || 'Perubahan gagal disimpan.');
	}

	// ---------- steps ----------
	/** Field errors stay in the form; otherwise refresh, then confirm */
	async function stepResult(result: Awaited<ReturnType<typeof post>>) {
		if (result.type === 'failure') {
			const fields = result.data?.fields as Record<string, string> | undefined;
			if (fields) return fields;
			toast.error(String(result.data?.error ?? 'Langkah gagal disimpan.'));
			return {};
		}
		if (result.type !== 'success') {
			toast.error('Langkah gagal disimpan.');
			return {};
		}
		await invalidateAll();
		toast.success(String(result.data?.done ?? 'Tersimpan.'));
	}

	function saveStep(projectId: string, stepId: string | null, value: StepValue) {
		return post(
			stepId ? 'updateStep' : 'addStep',
			stepId
				? { id: stepId, ...stepFields(value) }
				: { cardType: 'project', cardId: projectId, ...stepFields(value) }
		).then(stepResult);
	}

	// Ticking off the last open step asks for the next one (rule 4); the server enforces it too
	let promptOpen = $state(false);
	let promptStep = $state<PanelStep | null>(null);
	let promptErrors = $state<Record<string, string>>({});

	async function completeStep(step: PanelStep) {
		if ((data.detail?.steps.open.length ?? 0) <= 1) {
			promptStep = step;
			promptErrors = {};
			promptOpen = true;
			return;
		}
		await stepResult(await post('completeStep', { id: step.id }));
	}

	async function submitNextStep(next: StepValue | null, moveToNextStage: boolean) {
		if (!promptStep) return;
		const errors = await stepResult(
			await post('completeStep', {
				id: promptStep.id,
				withNext: next ? 'yes' : '',
				moveToNextStage: moveToNextStage ? 'yes' : '',
				...(next ? stepFields(next, 'next.') : {})
			})
		);
		if (errors && Object.keys(errors).length) {
			promptErrors = errors;
			return;
		}
		promptOpen = false;
		promptStep = null;
	}

	let addStepOpen = $state(false);
	let addStepCard = $state<{ id: string; title: string } | null>(null);
	function openAddStep(p: Project) {
		addStepCard = { id: p.id, title: p.name };
		addStepOpen = true;
	}

	// ---------- drawers ----------
	let projectDrawer: ReturnType<typeof ProjectFormDrawer> | undefined = $state();
	// open while the URL has ?project=…; closing it removes the param (closeProject)
	let detailOpen = $derived(!!data.detail);
	const openProject = (id: string) => go({ project: id });
	const closeProject = () => go({ project: undefined });
	let deleteOpen = $state(false);

	function editDetail() {
		const d = data.detail;
		if (!d) return;
		closeProject();
		projectDrawer?.openEdit(d);
	}
</script>

<Topbar title="Proyek">
	{#snippet filters()}
		<div class="flex flex-wrap items-center gap-3">
			<nav class="bf-seg" aria-label="Board">
				<a href={resolve('pipeline')}>Sales</a>
				<a href={resolve('projects')} aria-current="page">Proyek</a>
			</nav>
			<span class="text-small text-ink-2">
				Nilai kontrak berjalan <b class="text-ink">{rupiahShort(contractTotal)}</b> · diterima
				<b class="text-ink">{rupiahShort(paidTotal)}</b>
			</span>
		</div>
	{/snippet}
</Topbar>

<!-- boards use the full window width -->
<main class="page-body max-w-none! gap-4!">
	<form
		method="get"
		role="search"
		class="flex flex-wrap items-center gap-3"
		onsubmit={(e) => {
			e.preventDefault();
			go({ q: q || undefined });
		}}
	>
		<label class="bf-search min-w-0 flex-[1_1_240px] bg-surface!">
			<Search size={16} strokeWidth={2} aria-hidden="true" />
			<input
				type="search"
				name="q"
				bind:value={q}
				oninput={() => {
					clearTimeout(qTimer);
					qTimer = setTimeout(() => go({ q: q || undefined }), 300);
				}}
				placeholder="Cari proyek atau klien"
				aria-label="Cari proyek"
				maxlength="100"
			/>
		</label>
		<label class="sr-only" for="filter-owner">Pemilik</label>
		<select
			id="filter-owner"
			name="owner"
			class="min-h-10 rounded-control border border-line bg-surface px-3 text-small font-semibold"
			value={data.params.owner ?? ''}
			onchange={(e) => go({ owner: e.currentTarget.value || undefined })}
		>
			<option value="">Semua pemilik</option>
			{#each data.owners as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
		</select>
		<label class="sr-only" for="filter-service">Layanan</label>
		<select
			id="filter-service"
			name="service"
			class="min-h-10 rounded-control border border-line bg-surface px-3 text-small font-semibold"
			value={data.params.service ?? ''}
			onchange={(e) => go({ service: e.currentTarget.value || undefined })}
		>
			<option value="">Semua layanan</option>
			{#each SERVICE_TYPES as s (s)}<option value={s}>{SERVICE_TYPE_LABELS[s]}</option>{/each}
		</select>
		<button
			type="button"
			class={[
				'bf-chip min-h-10 cursor-pointer px-3.5! text-small!',
				data.params.late ? 'bg-danger-fill! text-on-accent!' : 'bf-chip--danger'
			]}
			aria-pressed={data.params.late ? 'true' : 'false'}
			onclick={() => go({ late: data.params.late ? undefined : '1' })}
		>
			{data.lateCount} terlambat
		</button>
		{#if hasFilters}
			<a
				href={resolve('projects')}
				class="text-small font-bold text-accent-ink"
				onclick={() => (q = '')}
				data-sveltekit-replacestate>Hapus filter</a
			>
		{/if}
	</form>

	<KanbanBoard
		label="Project Delivery"
		{columns}
		{lanes}
		itemLabel={(p: Project) => p.name}
		total={(items) => {
			const sum = items.reduce((s, p) => s + (p.contractValue ?? 0), 0);
			return sum ? rupiahShort(sum) : null;
		}}
		{onMove}
		type="project"
	>
		{#snippet card(p, ctx)}
			<KanbanCard
				client={p.clientName}
				service={p.serviceType ? SERVICE_TYPE_LABELS[p.serviceType] : null}
				title={p.name}
				value={p.contractValue ? rupiahShort(p.contractValue) : null}
				owner={p.ownerName}
				daysInStage={daysInStage(new Date(p.stageChangedAt), now)}
				onopen={() => openProject(p.id)}
			>
				{#snippet extra()}
					<PaymentProgress paid={p.paid} contractValue={p.contractValue} />
					{#if p.targetEndDate}
						<span
							class={[
								'inline-flex items-center gap-1.5 text-small font-semibold',
								overdue(p.stage, p.targetEndDate) ? 'text-danger' : 'text-ink-2'
							]}
						>
							<CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
							{overdue(p.stage, p.targetEndDate) ? 'Lewat target' : 'Target'}
							{dateID(p.targetEndDate)}
						</span>
					{/if}
				{/snippet}
				{#snippet next()}
					<NextActionBox
						step={p.next ? { ...p.next, dueAt: new Date(p.next.dueAt) } : null}
						{now}
						allowNone={p.stage === 'done'}
						onadd={() => openAddStep(p)}
					/>
				{/snippet}
				{#snippet menu()}
					<MoveMenu
						itemLabel={p.name}
						targets={ctx.targets}
						onmove={ctx.moveTo}
						disabled={ctx.busy}
					/>
				{/snippet}
			</KanbanCard>
		{/snippet}
	</KanbanBoard>

	{#if data.projects.length === 0}
		<p class="rounded-card bg-surface px-4 py-6 text-center text-body font-semibold text-ink-2">
			{hasFilters
				? 'Tidak ada proyek yang cocok dengan filter.'
				: 'Belum ada proyek. Proyek dibuat saat deal di Pipeline Sales dipindah ke Deal ✓.'}
		</p>
	{/if}
</main>

<ProjectFormDrawer bind:this={projectDrawer} form={data.projectForm} owners={data.owners} />

<NextStepPrompt
	bind:open={promptOpen}
	completedTitle={promptStep?.title ?? ''}
	cardTitle={data.detail?.name ?? ''}
	canSkip={data.detail?.stage === 'done'}
	nextStageLabel={data.detail && NEXT_PROJECT_STAGE[data.detail.stage]
		? PROJECT_STAGE_META[NEXT_PROJECT_STAGE[data.detail.stage]!].label
		: null}
	assignees={data.owners}
	errors={promptErrors}
	onsubmit={submitNextStep}
	oncancel={() => (promptStep = null)}
/>

<AddStepModal
	bind:open={addStepOpen}
	cardTitle={addStepCard?.title ?? ''}
	assignees={data.owners}
	onsubmit={(value) => saveStep(addStepCard!.id, null, value)}
/>

<Drawer
	bind:open={detailOpen}
	title={data.detail?.name ?? 'Proyek'}
	description={data.detail?.clientName}
	onclose={closeProject}
>
	{#if data.detail}
		{@const d = data.detail}
		<div class="flex flex-col gap-5">
			<div class="flex flex-wrap items-center gap-2">
				<span class={['bf-chip', PROJECT_STAGE_META[d.stage].chip]}
					>{PROJECT_STAGE_META[d.stage].label}</span
				>
				{#if d.serviceType}<span class="bf-chip bf-chip--service"
						>{SERVICE_TYPE_LABELS[d.serviceType]}</span
					>{/if}
				<a
					href={resolve('/(app)/clients/[id]', { id: d.clientId })}
					class="ml-auto inline-flex items-center gap-1 text-small font-bold text-accent-ink"
				>
					Buka klien <ExternalLink size={14} strokeWidth={2} />
				</a>
			</div>

			<section class="rounded-kanban border border-line p-4" aria-label="Pembayaran">
				<PaymentProgress paid={d.paid} contractValue={d.contractValue} />
				{#if d.contractValue}
					<p class="mt-2 text-small text-ink-2">
						Diterima {rupiah(d.paid)} dari {rupiah(d.contractValue)}{d.paid < d.contractValue
							? ` · sisa ${rupiah(d.contractValue - d.paid)}`
							: ''}
					</p>
				{/if}
			</section>

			<dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-body">
				<div>
					<dt class="text-small font-bold text-ink-2">Tanggal mulai</dt>
					<dd>{d.startDate ? dateID(d.startDate) : '–'}</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Target selesai</dt>
					<dd class={[overdue(d.stage, d.targetEndDate) && 'font-bold text-danger']}>
						{d.targetEndDate ? dateID(d.targetEndDate) : '–'}
					</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Di tahap ini</dt>
					<dd>{daysInStage(new Date(d.stageChangedAt), now)} hari</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Selesai pada</dt>
					<dd>{d.finishedAt ? dateID(d.finishedAt) : '–'}</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Pemilik</dt>
					<dd class="mt-1 flex items-center gap-2">
						{#if d.ownerName}<Avatar name={d.ownerName} size={24} />{d.ownerName}{:else}–{/if}
					</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Dari deal</dt>
					<dd>
						{#if d.dealId}
							<a
								href={resolve(`/(app)/pipeline?deal=${d.dealId}`)}
								class="font-semibold text-accent-ink">{d.dealTitle}</a
							>
						{:else}–{/if}
					</dd>
				</div>
			</dl>

			<section class="flex flex-col gap-2" aria-label="Langkah">
				<h3 class="text-small font-bold text-ink-2">Langkah</h3>
				<StepsPanel
					steps={d.steps}
					assignees={data.owners}
					{now}
					oncomplete={completeStep}
					onsave={(id, value) => saveStep(d.id, id, value)}
				/>
			</section>

			<section class="flex flex-col gap-3">
				<h3 class="text-small font-bold text-ink-2">Riwayat proyek</h3>
				<Timeline entries={d.timeline} empty="Belum ada aktivitas untuk proyek ini." />
			</section>
		</div>
	{/if}
	{#snippet footer()}
		<button
			type="button"
			class="bf-btn bf-btn--ghost mr-auto text-danger!"
			onclick={() => (deleteOpen = true)}
		>
			<Trash size={16} strokeWidth={1.75} />
			Hapus
		</button>
		<button type="button" class="bf-btn bf-btn--secondary" onclick={closeProject}>Tutup</button>
		<button type="button" class="bf-btn bf-btn--secondary" onclick={editDetail}>
			<Pencil size={16} strokeWidth={1.75} />
			Edit proyek
		</button>
	{/snippet}
</Drawer>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Hapus proyek?"
	action="?/deleteProject"
	fields={{ id: data.detail?.id ?? '' }}
	confirmLabel="Hapus proyek"
	tone="danger"
	onsuccess={closeProject}
>
	{#if data.detail}
		<b class="text-ink">{data.detail.name}</b> dihapus beserta langkah dan rencananya. Tidak bisa
		jika proyek ini sudah punya transaksi atau invoice.
		{#if data.detail.dealTitle}Deal "{data.detail.dealTitle}" tetap di Deal ✓ dan bisa dibuatkan
			proyek lagi.{/if}
	{/if}
</ConfirmDialog>
