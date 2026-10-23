<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Avatar from '#lib/components/Avatar.svelte';
	import Timeline from '#lib/components/clients/Timeline.svelte';
	import DealFormDrawer from '#lib/components/deals/DealFormDrawer.svelte';
	import LostModal from '#lib/components/deals/LostModal.svelte';
	import WonModal, { type WonFields } from '#lib/components/deals/WonModal.svelte';
	import KanbanBoard, { type KanbanColumn } from '#lib/components/kanban/KanbanBoard.svelte';
	import KanbanCard from '#lib/components/kanban/KanbanCard.svelte';
	import MoveMenu from '#lib/components/kanban/MoveMenu.svelte';
	import NextActionBox from '#lib/components/kanban/NextActionBox.svelte';
	import AddStepModal from '#lib/components/steps/AddStepModal.svelte';
	import NextStepPrompt from '#lib/components/steps/NextStepPrompt.svelte';
	import StepsPanel, { type PanelStep } from '#lib/components/steps/StepsPanel.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		DEAL_STAGE_META,
		DEAL_STAGES,
		NEXT_DEAL_STAGE,
		OPEN_DEAL_STAGES,
		PROJECT_STAGE_META,
		SERVICE_TYPE_LABELS,
		SERVICE_TYPES
	} from '#lib/constants.ts';
	import { dateID, rupiah, rupiahShort } from '#lib/format.ts';
	import { toLanes, type KanbanMove } from '#lib/kanban.ts';
	import { stepFields, type StepValue } from '#lib/step-form.ts';
	import { daysInStage } from '#lib/next-action.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Deal = (typeof data.deals)[number];

	// One clock for every card; refresh each minute so "Hari ini 14:00" turns late on time
	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(t);
	});

	const columns: KanbanColumn[] = DEAL_STAGES.map((s) => ({
		key: s,
		label: DEAL_STAGE_META[s].label,
		dot: DEAL_STAGE_META[s].dot,
		collapsed: s === 'won' || s === 'lost',
		note: s === 'won' || s === 'lost' ? '30 hari terakhir' : undefined
	}));
	const lanes = $derived(toLanes(data.deals, DEAL_STAGES, (d) => d.stage));
	const openValue = $derived(
		data.deals
			.filter((d) => (OPEN_DEAL_STAGES as readonly string[]).includes(d.stage))
			.reduce((s, d) => s + (d.valueEstimate ?? 0), 0)
	);
	const dealById = (id: string) => data.deals.find((d) => d.id === id);

	// ---------- URL helpers (filters and the drawer live in the query string) ----------
	function query(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`pipeline?${qs}`) : resolve('pipeline');
	}
	const go = (changes: Record<string, string | undefined>) =>
		goto(query(changes), { replace: true, reset: false });

	let q = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	const hasFilters = $derived(
		Boolean(data.params.q || data.params.owner || data.params.service || data.params.late)
	);

	// ---------- talking to the form actions from code (board moves, modals) ----------
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

	const moveFields = (m: KanbanMove) => ({
		id: m.id,
		to: m.to,
		beforeId: m.beforeId ?? '',
		afterId: m.afterId ?? ''
	});

	/** Result of a move: refresh the board data first, then confirm */
	async function finish(result: Awaited<ReturnType<typeof post>>) {
		if (result.type === 'success') {
			await invalidateAll();
			toast.success(String(result.data?.done ?? 'Tersimpan.'));
			return;
		}
		const msg =
			result.type === 'failure' ? String(result.data?.error ?? '') : 'Perubahan gagal disimpan.';
		throw new Error(msg || 'Perubahan gagal disimpan.');
	}

	// A move waiting for the Deal ✓ or Batal modal. Settles exactly once.
	type Pending = { move: KanbanMove; settle: (ok: boolean, error?: Error) => void };
	let pending: Pending | null = null;
	function waitFor(move: KanbanMove) {
		return new Promise<boolean>((resolvePromise, reject) => {
			let done = false;
			pending = {
				move,
				settle: (ok, error) => {
					if (done) return;
					done = true;
					pending = null;
					if (error) reject(error);
					else resolvePromise(ok);
				}
			};
		});
	}

	let wonOpen = $state(false);
	let wonMode = $state<'move' | 'later'>('move');
	let wonDeal = $state<{ id: string; title: string; valueEstimate: number | null } | null>(null);
	let wonErrors = $state<Record<string, string>>({});
	let lostOpen = $state(false);
	let lostDeal = $state<{ title: string } | null>(null);

	async function onMove(move: KanbanMove) {
		const d = dealById(move.id);
		if (move.to === 'won' && move.from !== 'won') {
			wonDeal = d ? { id: d.id, title: d.title, valueEstimate: d.valueEstimate } : null;
			wonMode = 'move';
			wonErrors = {};
			wonOpen = true;
			return waitFor(move);
		}
		if (move.to === 'lost' && move.from !== 'lost') {
			lostDeal = d ? { title: d.title } : null;
			lostOpen = true;
			return waitFor(move);
		}
		await finish(await post('move', moveFields(move)));
	}

	async function submitWon(fields: WonFields | null) {
		const isMove = wonMode === 'move' && pending;
		const result = isMove
			? await post('move', {
					...moveFields(pending!.move),
					createProject: fields ? 'yes' : '',
					...(fields ?? {})
				})
			: await post('createProject', { id: wonDeal!.id, ...fields! });
		// Validation problems stay in the modal so the person can fix them
		if (result.type === 'failure' && result.data?.fields) {
			wonErrors = result.data.fields as Record<string, string>;
			return;
		}
		try {
			await finish(result);
			wonOpen = false;
			pending?.settle(true);
		} catch (e) {
			wonOpen = false;
			if (pending) pending.settle(false, e as Error);
			else toast.error((e as Error).message);
		}
	}

	async function submitLost(reason: string) {
		if (!pending) return;
		const result = await post('move', { ...moveFields(pending.move), lostReason: reason });
		try {
			await finish(result);
			lostOpen = false;
			pending?.settle(true);
		} catch (e) {
			lostOpen = false;
			pending?.settle(false, e as Error);
		}
	}

	// ---------- steps (P1-07) ----------
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

	function saveStep(dealId: string, stepId: string | null, value: StepValue) {
		return post(
			stepId ? 'updateStep' : 'addStep',
			stepId
				? { id: stepId, ...stepFields(value) }
				: { cardType: 'deal', cardId: dealId, ...stepFields(value) }
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
	function openAddStep(d: Deal) {
		addStepCard = { id: d.id, title: d.title };
		addStepOpen = true;
	}

	// ---------- drawers ----------
	let dealDrawer: ReturnType<typeof DealFormDrawer> | undefined = $state();
	// open while the URL has ?deal=…; closing it removes the param (closeDeal)
	let detailOpen = $derived(!!data.detail);
	const openDeal = (id: string) => go({ deal: id });
	const closeDeal = () => go({ deal: undefined });

	function editDetail() {
		const d = data.detail;
		if (!d) return;
		closeDeal();
		dealDrawer?.openEdit({
			id: d.id,
			clientId: d.clientId,
			title: d.title,
			serviceType: d.serviceType,
			valueEstimate: d.valueEstimate,
			expectedClose: d.expectedClose,
			ownerId: d.ownerId
		});
	}

	function createProjectLater() {
		const d = data.detail;
		if (!d) return;
		wonDeal = { id: d.id, title: d.title, valueEstimate: d.valueEstimate };
		wonMode = 'later';
		wonErrors = {};
		closeDeal();
		wonOpen = true;
	}
</script>

<Topbar title="Pipeline Sales">
	{#snippet filters()}
		<div class="flex flex-wrap items-center gap-3">
			<nav class="bf-seg" aria-label="Board">
				<a href={resolve('pipeline')} aria-current="page">Sales</a>
				<a href={resolve('projects')}>Proyek</a>
			</nav>
			<span class="text-small text-ink-2">
				Nilai terbuka <b class="text-ink">{rupiahShort(openValue)}</b>
			</span>
		</div>
	{/snippet}
	{#snippet actions()}
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => dealDrawer?.openCreate()}>
			<Plus size={18} strokeWidth={2} />
			Deal
		</button>
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
				placeholder="Cari deal atau klien"
				aria-label="Cari deal"
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
				href={resolve('pipeline')}
				class="text-small font-bold text-accent-ink"
				onclick={() => (q = '')}
				data-sveltekit-replacestate>Hapus filter</a
			>
		{/if}
	</form>

	<KanbanBoard
		label="Pipeline Sales"
		{columns}
		{lanes}
		itemLabel={(d: Deal) => d.title}
		total={(items) => {
			const sum = items.reduce((s, d) => s + (d.valueEstimate ?? 0), 0);
			return sum ? rupiahShort(sum) : null;
		}}
		{onMove}
		type="deal"
	>
		{#snippet card(d, ctx)}
			<KanbanCard
				client={d.clientName}
				service={d.serviceType ? SERVICE_TYPE_LABELS[d.serviceType] : null}
				title={d.title}
				value={d.valueEstimate ? rupiahShort(d.valueEstimate) : null}
				owner={d.ownerName}
				daysInStage={daysInStage(new Date(d.stageChangedAt), now)}
				onopen={() => openDeal(d.id)}
			>
				{#snippet next()}
					<NextActionBox
						step={d.next ? { ...d.next, dueAt: new Date(d.next.dueAt) } : null}
						{now}
						allowNone={d.stage === 'won' || d.stage === 'lost'}
						onadd={() => openAddStep(d)}
					/>
				{/snippet}
				{#snippet menu()}
					<MoveMenu
						itemLabel={d.title}
						targets={ctx.targets}
						onmove={ctx.moveTo}
						disabled={ctx.busy}
					/>
				{/snippet}
			</KanbanCard>
		{/snippet}
	</KanbanBoard>

	{#if data.deals.length === 0}
		<p class="rounded-card bg-surface px-4 py-6 text-center text-body font-semibold text-ink-2">
			{hasFilters
				? 'Tidak ada deal yang cocok dengan filter.'
				: 'Belum ada deal. Tambahkan deal pertama dengan tombol "+ Deal".'}
		</p>
	{/if}
</main>

<DealFormDrawer
	bind:this={dealDrawer}
	form={data.dealForm}
	clients={data.clients}
	owners={data.owners}
/>

<WonModal
	bind:open={wonOpen}
	deal={wonDeal}
	mode={wonMode}
	errors={wonErrors}
	onsubmit={submitWon}
	oncancel={() => pending?.settle(false)}
/>
<LostModal
	bind:open={lostOpen}
	deal={lostDeal}
	onsubmit={submitLost}
	oncancel={() => pending?.settle(false)}
/>

<NextStepPrompt
	bind:open={promptOpen}
	completedTitle={promptStep?.title ?? ''}
	cardTitle={data.detail?.title ?? ''}
	canSkip={data.detail?.stage === 'won' || data.detail?.stage === 'lost'}
	nextStageLabel={data.detail && NEXT_DEAL_STAGE[data.detail.stage]
		? DEAL_STAGE_META[NEXT_DEAL_STAGE[data.detail.stage]!].label
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
	title={data.detail?.title ?? 'Deal'}
	description={data.detail?.clientName}
	onclose={closeDeal}
>
	{#if data.detail}
		{@const d = data.detail}
		<div class="flex flex-col gap-5">
			<div class="flex flex-wrap items-center gap-2">
				<span class={['bf-chip', DEAL_STAGE_META[d.stage].chip]}
					>{DEAL_STAGE_META[d.stage].label}</span
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

			<dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-body">
				<div>
					<dt class="text-small font-bold text-ink-2">Perkiraan nilai</dt>
					<dd class="font-bold">{d.valueEstimate ? rupiah(d.valueEstimate) : '–'}</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Peluang</dt>
					<dd>{d.probability ?? '–'}{d.probability !== null ? '%' : ''}</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Target closing</dt>
					<dd>{d.expectedClose ? dateID(d.expectedClose) : '–'}</dd>
				</div>
				<div>
					<dt class="text-small font-bold text-ink-2">Di tahap ini</dt>
					<dd>{daysInStage(new Date(d.stageChangedAt), now)} hari</dd>
				</div>
				<div class="col-span-2">
					<dt class="text-small font-bold text-ink-2">Pemilik</dt>
					<dd class="mt-1 flex items-center gap-2">
						{#if d.ownerName}<Avatar name={d.ownerName} size={24} />{d.ownerName}{:else}–{/if}
					</dd>
				</div>
				{#if d.stage === 'lost' && d.lostReason}
					<div class="col-span-2">
						<dt class="text-small font-bold text-ink-2">Alasan batal</dt>
						<dd class="text-danger">{d.lostReason}</dd>
					</div>
				{/if}
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

			{#if d.stage === 'won'}
				<section class="flex flex-col gap-2 rounded-kanban bg-success-bg p-4">
					{#if d.project}
						<p class="text-small font-bold text-success">Proyek</p>
						<a
							href={resolve(`/(app)/projects?project=${d.project.id}`)}
							class="font-bold text-ink hover:text-accent-ink">{d.project.name}</a
						>
						<p class="text-small text-ink-2">Tahap {PROJECT_STAGE_META[d.project.stage].label}</p>
					{:else}
						<p class="text-small font-bold text-success">Deal menang, belum ada proyek.</p>
						<button
							type="button"
							class="bf-btn bf-btn--primary bf-btn--sm w-fit"
							onclick={createProjectLater}
						>
							Buat proyek
						</button>
					{/if}
				</section>
			{/if}

			<section class="flex flex-col gap-3">
				<h3 class="text-small font-bold text-ink-2">Riwayat deal</h3>
				<Timeline entries={d.timeline} empty="Belum ada aktivitas untuk deal ini." />
			</section>
		</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={closeDeal}>Tutup</button>
		<button type="button" class="bf-btn bf-btn--secondary" onclick={editDetail}>
			<Pencil size={16} strokeWidth={1.75} />
			Edit deal
		</button>
	{/snippet}
</Drawer>
