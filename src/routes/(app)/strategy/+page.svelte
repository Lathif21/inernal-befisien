<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import AiPanel from '#lib/components/ai/AiPanel.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import PeriodFilter from '#lib/components/PeriodFilter.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import AddStepModal from '#lib/components/steps/AddStepModal.svelte';
	import NextStepPrompt from '#lib/components/steps/NextStepPrompt.svelte';
	import CancelPlanModal from '#lib/components/strategy/CancelPlanModal.svelte';
	import PlanCard from '#lib/components/strategy/PlanCard.svelte';
	import PlanFormDrawer from '#lib/components/strategy/PlanFormDrawer.svelte';
	import StepRunModal from '#lib/components/strategy/StepRunModal.svelte';
	import {
		DEAL_STAGE_META,
		NEXT_DEAL_STAGE,
		NEXT_PROJECT_STAGE,
		PROJECT_STAGE_META,
		TERMINAL_STAGES
	} from '#lib/constants.ts';
	import { dateID, dayKeyWib } from '#lib/format.ts';
	import { nextActionState, nextActionWhen } from '#lib/next-action.ts';
	import type { PlanCardData, StrategyStep } from '#lib/server/services/plans.ts';
	import { stepFields, stepValueOf, type StepValue } from '#lib/step-form.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(t);
	});

	// ---------- URL (search, Semua / Saya, plan page and the period live in the query string) ----------
	function href(changes: Record<string, string | undefined>) {
		const merged = { ...Object.fromEntries(page.url.searchParams), ...changes };
		const qs = Object.entries(merged)
			.filter(([, v]) => !!v)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
			.join('&');
		return qs ? resolve(`strategy?${qs}`) : resolve('strategy');
	}
	/** Period or filter changes start the plan list at page 1 */
	const filterHref = (changes: Record<string, string | undefined>) =>
		href({ ...changes, plans: undefined });

	let q = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	function search() {
		clearTimeout(qTimer);
		qTimer = setTimeout(
			() => goto(filterHref({ q: q || undefined }), { replace: true, reset: false }),
			300
		);
	}

	// ---------- sections ----------
	const late = $derived(
		data.attention.filter((s) => nextActionState(new Date(s.dueAt), now, s.allDay) === 'late')
	);
	const today = $derived(
		data.attention.filter((s) => nextActionState(new Date(s.dueAt), now, s.allDay) !== 'late')
	);

	/** Jadwal: steps of the period grouped by WIB day ("KAMIS, 22 OKT · HARI INI") */
	const days = $derived.by(() => {
		const todayKey = dayKeyWib(now);
		const groups: { key: string; label: string; steps: StrategyStep[] }[] = [];
		for (const s of data.schedule) {
			const key = dayKeyWib(new Date(s.dueAt));
			let g = groups.at(-1);
			if (!g || g.key !== key) {
				const label = dateID(new Date(s.dueAt), 'long')
					.replace(/ \d{4}$/, '')
					.toUpperCase();
				g = { key, label: key === todayKey ? `${label} · HARI INI` : label, steps: [] };
				groups.push(g);
			}
			g.steps.push(s);
		}
		return groups;
	});
	const openInPeriod = $derived(data.schedule.filter((s) => !s.doneAt).length);

	// ---------- form actions from code ----------
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

	/** Field errors stay in the form; otherwise refresh the page data, then confirm */
	async function settle(result: Awaited<ReturnType<typeof post>>) {
		if (result.type === 'failure') {
			const fields = result.data?.fields as Record<string, string> | undefined;
			if (fields) return fields;
			toast.error(String(result.data?.error ?? 'Perubahan gagal disimpan.'));
			return {};
		}
		if (result.type !== 'success') {
			toast.error('Perubahan gagal disimpan.');
			return {};
		}
		await invalidateAll();
		toast.success(String(result.data?.done ?? 'Tersimpan.'));
	}

	// ---------- ticking off (rule 4: the last open step of an active card asks for the next one) ----------
	let promptOpen = $state(false);
	let promptStep = $state<StrategyStep | null>(null);
	let promptErrors = $state<Record<string, string>>({});
	const cardStage = (s: StrategyStep) => s.projectStage ?? s.dealStage;

	async function complete(s: StrategyStep) {
		if (s.cardOpenSteps <= 1) {
			promptStep = s;
			promptErrors = {};
			promptOpen = true;
			return;
		}
		await settle(await post('completeStep', { id: s.id }));
	}

	async function submitNext(next: StepValue | null, moveToNextStage: boolean) {
		if (!promptStep) return;
		const errors = await settle(
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

	const promptNextStage = $derived.by(() => {
		if (promptStep?.projectStage) {
			const to = NEXT_PROJECT_STAGE[promptStep.projectStage];
			return to ? PROJECT_STAGE_META[to].label : null;
		}
		const to = promptStep?.dealStage ? NEXT_DEAL_STAGE[promptStep.dealStage] : null;
		return to ? DEAL_STAGE_META[to].label : null;
	});

	// ---------- plans ----------
	let planDrawer: ReturnType<typeof PlanFormDrawer> | undefined = $state();
	/** "Jalankan" on a system-action step (P2-13) */
	let runStepId = $state<string | null>(null);
	const addPlanStep = (planId: string, value: StepValue) =>
		post('addPlanStep', { planId, ...stepFields(value) }).then(settle);
	const moveStep = (id: string, direction: 'up' | 'down') =>
		post('moveStep', { id, direction }).then(settle);
	/** "Batalkan rencana" confirms first: it deletes the plan's open steps (and may need a next step) */
	let cancelPlanOpen = $state(false);
	let cancelPlan = $state<PlanCardData | null>(null);
	function planStatus(plan: PlanCardData, status: 'achieved' | 'dropped') {
		if (status === 'dropped') {
			cancelPlan = plan;
			cancelPlanOpen = true;
			return;
		}
		post('planStatus', { id: plan.id, status }).then(settle);
	}
	const dropPlan = (next: StepValue | null) =>
		post('planStatus', {
			id: cancelPlan!.id,
			status: 'dropped',
			withNext: next ? 'yes' : '',
			...(next ? stepFields(next, 'next.') : {})
		}).then(settle);

	// Step menu: "Ubah langkah" (modal) and "Hapus langkah" (confirm)
	let editStepOpen = $state(false);
	let editStep = $state<StrategyStep | null>(null);
	function openEditStep(s: StrategyStep) {
		editStep = s;
		editStepOpen = true;
	}
	const saveEditStep = (value: StepValue) =>
		post('updateStep', { id: editStep!.id, ...stepFields(value) }).then(settle);

	let deleteStepOpen = $state(false);
	let deleteStep = $state<StrategyStep | null>(null);
	function openDeleteStep(s: StrategyStep) {
		// Rule 4: an active card keeps one open step (the server refuses too)
		if (!s.doneAt && s.cardOpenSteps <= 1 && !TERMINAL_STAGES.includes(cardStage(s)!)) {
			toast.error(
				`Ini satu-satunya langkah terbuka di ${s.cardTitle}. Ubah langkahnya, atau tambahkan langkah lain dulu.`
			);
			return;
		}
		deleteStep = s;
		deleteStepOpen = true;
	}

	// ---------- Saran AI (P2-02) ----------
	const cardsFor = (clientId: string) => [
		...data.cards.deals
			.filter((d) => d.clientId === clientId)
			.map((d) => ({ value: `deal:${d.id}`, label: `Deal · ${d.title}` })),
		...data.cards.projects
			.filter((p) => p.clientId === clientId)
			.map((p) => ({ value: `project:${p.id}`, label: `Proyek · ${p.title}` }))
	];
	const aiAccept = (id: string, value: StepValue, card: string | null) => {
		const [cardType, cardId] = card ? card.split(':') : [];
		return post('acceptSuggestion', {
			id,
			...stepFields(value),
			...(card ? { cardType, cardId } : {})
		}).then(settle);
	};
	const aiDismiss = (id: string) =>
		post('dismissSuggestion', { id })
			.then(settle)
			.then(() => {});
	const askAi = (planId: string) =>
		post('askAi', { planId })
			.then(settle)
			.then(() => {});
</script>

{#snippet attentionRow(s: StrategyStep, tone: 'late' | 'today')}
	<li class="flex items-start gap-3 border-t border-tint-2 py-2.5 first:border-t-0">
		<button
			type="button"
			class="bf-hit mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong text-transparent hover:border-success-fill hover:text-success-fill"
			aria-label="Tandai selesai: {s.title}"
			onclick={() => complete(s)}
		>
			<Check size={13} strokeWidth={3} />
		</button>
		<div class="min-w-0 flex-1">
			<p class="font-bold wrap-break-word">{s.title}</p>
			<p class="truncate text-small text-ink-2">{s.clientName} · {s.cardTitle}</p>
		</div>
		<span
			class={[
				'shrink-0 font-mono text-[12px] font-medium',
				tone === 'late' ? 'text-danger' : 'text-warning'
			]}
		>
			{nextActionWhen(new Date(s.dueAt), now, s.allDay).replace(/^Hari ini /, '')}
		</span>
	</li>
{/snippet}

<Topbar title="Strategi">
	{#snippet filters()}
		<PeriodFilter value={data.period} href={filterHref} />
	{/snippet}
	{#snippet actions()}
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => planDrawer?.openCreate()}>
			<Plus size={18} strokeWidth={2} />
			Rencana
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	<div class="flex flex-wrap items-center gap-3">
		<p class="min-w-0 flex-1 text-small text-ink-2">
			<b class="text-ink">{data.plans.total}</b> rencana aktif ·
			<b class="text-ink">{openInPeriod}</b> langkah terbuka di periode ini
		</p>
		<label class="bf-search min-w-0 flex-[1_1_240px] bg-surface!">
			<Search size={16} strokeWidth={2} aria-hidden="true" />
			<input
				type="search"
				bind:value={q}
				oninput={search}
				placeholder="Cari klien, rencana, atau langkah"
				aria-label="Cari di Strategi"
				maxlength="100"
			/>
		</label>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- filterHref() uses resolve() -->
		<nav class="bf-seg bf-seg--dark" aria-label="Penanggung jawab">
			<a
				href={filterHref({ mine: undefined })}
				aria-current={data.params.mine ? undefined : 'page'}
				data-sveltekit-noscroll>Semua</a
			>
			<a
				href={filterHref({ mine: '1' })}
				aria-current={data.params.mine ? 'page' : undefined}
				data-sveltekit-noscroll>Saya</a
			>
		</nav>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	<!-- Perlu perhatian: always first, ignores the period -->
	<section class="grid gap-4 *:min-w-0 md:grid-cols-2" aria-label="Perlu perhatian">
		<div class="flex flex-col gap-2 rounded-card border-t-4 border-danger-fill bg-surface p-5">
			<h2 class="text-[12.5px] font-extrabold tracking-[0.04em] text-danger">
				TERLAMBAT · {late.length}
			</h2>
			{#if late.length}
				<ul class="flex flex-col">
					{#each late as s (s.id)}{@render attentionRow(s, 'late')}{/each}
				</ul>
			{:else}
				<p class="text-small text-ink-3">Tidak ada langkah yang terlambat.</p>
			{/if}
		</div>
		<div class="flex flex-col gap-2 rounded-card border-t-4 border-warning-fill bg-surface p-5">
			<h2 class="text-[12.5px] font-extrabold tracking-[0.04em] text-warning">
				HARI INI · {today.length}
			</h2>
			{#if today.length}
				<ul class="flex flex-col">
					{#each today as s (s.id)}{@render attentionRow(s, 'today')}{/each}
				</ul>
			{:else}
				<p class="text-small text-ink-3">Tidak ada langkah untuk hari ini.</p>
			{/if}
		</div>
	</section>

	<div class="grid items-start gap-6 *:min-w-0 lg:grid-cols-3">
		<!-- Phone order: Perlu perhatian → Saran AI → Rencana → Jadwal -->
		<section
			class="order-2 flex flex-col gap-4 lg:order-1 lg:col-span-2"
			aria-label="Rencana strategi"
		>
			<h2 class="text-section-title">Rencana strategi</h2>
			{#if data.plans.plans.length === 0}
				{#if data.params.q || data.params.mine}
					<p
						class="rounded-card bg-surface px-4 py-6 text-center text-body font-semibold text-ink-2"
					>
						Tidak ada rencana yang cocok dengan filter.
					</p>
				{:else}
					<EmptyState
						illustration="integration"
						message="Belum ada rencana aktif. Buat rencana untuk deal atau proyek yang penting."
					>
						{#snippet action()}
							<button
								type="button"
								class="bf-btn bf-btn--primary"
								onclick={() => planDrawer?.openCreate()}
							>
								<Plus size={18} strokeWidth={2} />
								Buat rencana
							</button>
						{/snippet}
					</EmptyState>
				{/if}
			{:else}
				{#each data.plans.plans as plan (plan.id)}
					<PlanCard
						{plan}
						{now}
						assignees={data.owners}
						oncomplete={complete}
						onaddstep={addPlanStep}
						onmove={moveStep}
						oneditstep={openEditStep}
						ondeletestep={openDeleteStep}
						onrunstep={(s) => (runStepId = s.id)}
						onedit={() => planDrawer?.openEdit(plan)}
						onstatus={(status) => planStatus(plan, status)}
						onask={data.aiEnabled && data.aiSuggestionsOn ? () => askAi(plan.id) : undefined}
					/>
				{/each}
				<Pager
					page={data.plans.page}
					total={data.plans.total}
					pageSize={data.plans.perPage}
					noun="rencana"
					href={(n) => href({ plans: n > 1 ? String(n) : undefined })}
				/>
			{/if}
		</section>

		<div class="contents lg:order-2 lg:flex lg:flex-col lg:gap-6">
			<AiPanel
				class="order-1"
				off={!data.aiSuggestionsOn}
				schedule={data.aiSchedule}
				suggestions={data.suggestions}
				showClient
				{cardsFor}
				assignees={data.owners}
				onaccept={aiAccept}
				ondismiss={aiDismiss}
			/>

			<section
				class="order-3 flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5"
				aria-label="Jadwal"
			>
				<h2 class="text-section-title">Jadwal</h2>
				<p class="-mt-2 text-small text-ink-3">{data.period.label}</p>
				{#if days.length === 0}
					<p class="text-small text-ink-3">Tidak ada langkah di periode ini.</p>
				{:else}
					{#each days as d (d.key)}
						<div class="flex flex-col gap-1">
							<h3
								class={[
									'text-[12px] font-extrabold tracking-[0.04em]',
									d.label.endsWith('HARI INI') ? 'text-warning' : 'text-ink-2'
								]}
							>
								{d.label}
							</h3>
							<ul class="flex flex-col">
								{#each d.steps as s (s.id)}
									<li class="flex items-baseline gap-2.5 py-1">
										<span class="w-11 shrink-0 font-mono text-[12px] text-ink-2"
											>{s.allDay ? '—' : dateID(new Date(s.dueAt), 'time')}</span
										>
										<span
											class={[
												'min-w-0 flex-1 text-small',
												s.doneAt ? 'text-ink-3 line-through' : 'font-semibold'
											]}
										>
											{s.title}
											<span class="block truncate text-[12px] font-medium text-ink-3 no-underline"
												>{s.clientName}</span
											>
										</span>
										{#if !s.doneAt && TERMINAL_STAGES.includes(cardStage(s)!) === false && nextActionState(new Date(s.dueAt), now, s.allDay) === 'late'}
											<span class="bf-chip bf-chip--danger">Terlambat</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{/if}
			</section>
		</div>
	</div>
</main>

<PlanFormDrawer bind:this={planDrawer} form={data.planForm} cards={data.cards} />
<StepRunModal stepId={runStepId} onclose={() => (runStepId = null)} />

<AddStepModal
	bind:open={editStepOpen}
	cardTitle={editStep ? `${editStep.clientName} · ${editStep.cardTitle}` : ''}
	assignees={data.owners}
	initial={editStep ? stepValueOf(editStep) : null}
	onsubmit={saveEditStep}
/>

<CancelPlanModal
	bind:open={cancelPlanOpen}
	plan={cancelPlan}
	assignees={data.owners}
	onsubmit={dropPlan}
/>

<ConfirmDialog
	bind:open={deleteStepOpen}
	title="Hapus langkah?"
	action="?/deleteStep"
	fields={{ id: deleteStep?.id ?? '' }}
	confirmLabel="Hapus langkah"
	tone="danger"
>
	{#if deleteStep}
		<b class="text-ink">{deleteStep.title}</b> dihapus dari rencana "{deleteStep.planGoal}". Langkah
		yang terhapus tidak bisa dikembalikan.
	{/if}
</ConfirmDialog>

<NextStepPrompt
	bind:open={promptOpen}
	completedTitle={promptStep?.title ?? ''}
	cardTitle={promptStep ? `${promptStep.clientName} · ${promptStep.cardTitle}` : ''}
	canSkip={!!promptStep && TERMINAL_STAGES.includes(cardStage(promptStep)!)}
	nextStageLabel={promptNextStage}
	assignees={data.owners}
	errors={promptErrors}
	onsubmit={submitNext}
	oncancel={() => (promptStep = null)}
/>
