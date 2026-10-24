<script lang="ts">
	import { resolve } from '$app/paths';
	import { DropdownMenu } from 'bits-ui';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import StepRow from '#lib/components/strategy/StepRow.svelte';
	import { DEAL_STAGE_META, PROJECT_STAGE_META } from '#lib/constants.ts';
	import { dateID, rupiahShort } from '#lib/format.ts';
	import type { PlanCardData, StrategyStep } from '#lib/server/services/plans.ts';
	import { newStepValue, type StepValue } from '#lib/step-form.ts';
	import { toast } from '#lib/toast.ts';

	type Props = {
		plan: PlanCardData;
		now: Date;
		assignees: { id: string; name: string }[];
		oncomplete: (step: StrategyStep) => void;
		/** Resolves to field errors, or nothing when saved */
		onaddstep: (planId: string, value: StepValue) => Promise<Record<string, string> | void>;
		onmove: (stepId: string, direction: 'up' | 'down') => void;
		/** Step menu: "Ubah langkah" / "Hapus langkah" */
		oneditstep: (step: StrategyStep) => void;
		ondeletestep: (step: StrategyStep) => void;
		onedit: () => void;
		onstatus: (status: 'achieved' | 'dropped') => void;
		/** "Minta saran AI" for this plan; omitted = button disabled (AI not configured) */
		onask?: () => Promise<void>;
	};

	let {
		plan,
		now,
		assignees,
		oncomplete,
		onaddstep,
		onmove,
		oneditstep,
		ondeletestep,
		onedit,
		onstatus,
		onask
	}: Props = $props();

	let asking = $state(false);
	async function ask() {
		if (!onask) return;
		asking = true;
		try {
			await onask();
		} finally {
			asking = false;
		}
	}

	const PER_PAGE = 4;
	// Opens on the page with the first unfinished step; other pages are fetched on demand.
	// Writable derived: resets whenever the server sends the plan again.
	let view = $derived({ page: plan.stepPage, steps: plan.steps });
	let loading = $state(false);
	const pages = $derived(Math.max(1, Math.ceil(plan.totalSteps / PER_PAGE)));
	const first = $derived(plan.totalSteps === 0 ? 0 : (view.page - 1) * PER_PAGE + 1);
	const last = $derived(Math.min(plan.totalSteps, view.page * PER_PAGE));

	async function openPage(n: number) {
		if (n < 1 || n > pages || loading) return;
		loading = true;
		try {
			const res = await fetch(
				resolve(`/(app)/strategy/plans/[id]/steps?page=${n}`, { id: plan.id })
			);
			if (!res.ok) throw new Error();
			const data = (await res.json()) as { steps: StrategyStep[]; page: number };
			view = { page: data.page, steps: data.steps };
		} catch {
			toast.error('Langkah gagal dimuat. Coba lagi.');
		} finally {
			loading = false;
		}
	}

	const card = $derived(
		plan.projectId
			? {
					kind: 'Proyek',
					stage: plan.projectStage ? PROJECT_STAGE_META[plan.projectStage].label : '',
					value: plan.projectValue,
					chip: 'bf-chip--dark'
				}
			: {
					kind: 'Deal',
					stage: plan.dealStage ? DEAL_STAGE_META[plan.dealStage].label : '',
					value: plan.dealValue,
					chip: 'bf-chip--accent'
				}
	);
	const pct = $derived(plan.totalSteps ? Math.round((plan.doneSteps / plan.totalSteps) * 100) : 0);
	const allDone = $derived(plan.totalSteps > 0 && plan.doneSteps === plan.totalSteps);

	// Inline add-step form (Langkah baru · Tanggal · Jam · PIC · Tambah)
	let adding = $state(false);
	let value = $state<StepValue>(newStepValue());
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);
	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		try {
			const result = await onaddstep(plan.id, value);
			if (result) errors = result;
			else {
				adding = false;
				value = newStepValue();
				errors = {};
			}
		} finally {
			saving = false;
		}
	}
</script>

<article class="bf-plan" aria-label="Rencana {plan.goal}">
	<div class="flex flex-wrap items-start gap-3.5">
		<div class="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
			<a
				href={resolve('/(app)/clients/[id]', { id: plan.clientId })}
				class="bf-plan__client w-fit no-underline hover:text-accent-ink">{plan.clientName}</a
			>
			<h3 class="bf-plan__goal">{plan.goal}</h3>
			<span class="flex flex-wrap gap-1.5 pt-1">
				<span class={['bf-chip', card.chip]}
					>{card.kind} · {card.stage}{card.value ? ` · ${rupiahShort(card.value)}` : ''}</span
				>
				{#if plan.targetDate}<span class="bf-chip">Target {dateID(plan.targetDate)}</span>{/if}
				{#if plan.fromSuggestionId}<span class="bf-chip bf-chip--ai">Dibuat dari saran AI</span
					>{/if}
			</span>
		</div>
		<div class="flex flex-col items-end gap-1.5">
			<div class="flex items-center gap-1">
				<span class="bf-pager__info m-0!"
					>{plan.doneSteps} dari {plan.totalSteps} langkah selesai</span
				>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="bf-icon-btn size-8!" aria-label="Menu rencana {plan.goal}">
						<Ellipsis size={16} strokeWidth={2} />
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							align="end"
							sideOffset={6}
							class="z-50 min-w-52 rounded-kanban border border-line bg-surface p-1.5 shadow-raised"
						>
							{#each [{ label: 'Ubah rencana', run: onedit }, { label: 'Tandai tercapai', run: () => onstatus('achieved') }, { label: 'Batalkan rencana', run: () => onstatus('dropped') }] as item (item.label)}
								<DropdownMenu.Item
									class="flex min-h-(--size-touch) cursor-pointer items-center rounded-control px-3 text-body font-semibold data-highlighted:bg-tint-2"
									onSelect={item.run}>{item.label}</DropdownMenu.Item
								>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
			<div
				class="bf-progress w-[150px]"
				role="img"
				aria-label="{plan.doneSteps} dari {plan.totalSteps} langkah selesai"
			>
				<span style:width="{pct}%"></span>
			</div>
		</div>
	</div>

	{#if allDone}
		<div class="flex flex-wrap items-center gap-3 rounded-control bg-success-bg px-3 py-2">
			<span class="min-w-0 flex-1 text-small font-bold text-success">Semua langkah selesai.</span>
			<button
				type="button"
				class="bf-btn bf-btn--sm bg-success-fill text-on-accent"
				onclick={() => onstatus('achieved')}
			>
				Tandai tercapai
			</button>
		</div>
	{/if}

	{#if plan.totalSteps === 0}
		<p class="text-small text-ink-3">Belum ada langkah. Tambahkan langkah pertama rencana ini.</p>
	{:else}
		<ol class="bf-steps" aria-busy={loading}>
			{#each view.steps as s, i (s.id)}
				{@const index = (view.page - 1) * PER_PAGE + i}
				<StepRow
					step={s}
					{now}
					oncomplete={() => oncomplete(s)}
					onmove={(d) => onmove(s.id, d)}
					canUp={index > 0}
					canDown={index < plan.totalSteps - 1}
					onedit={() => oneditstep(s)}
					ondelete={() => ondeletestep(s)}
				/>
			{/each}
		</ol>
	{/if}

	{#if pages > 1}
		<nav class="bf-pager bf-pager--sm" aria-label="Halaman langkah {plan.goal}">
			<span class="bf-pager__info">Langkah {first}–{last} dari {plan.totalSteps}</span>
			<button
				type="button"
				aria-label="Langkah sebelumnya"
				disabled={view.page <= 1 || loading}
				onclick={() => openPage(view.page - 1)}
			>
				<ChevronLeft size={14} strokeWidth={2.4} />
			</button>
			{#each Array.from({ length: pages }, (_, i) => i + 1) as n (n)}
				<button
					type="button"
					aria-current={n === view.page ? 'page' : undefined}
					aria-label="Halaman langkah {n}"
					disabled={loading}
					onclick={() => openPage(n)}>{n}</button
				>
			{/each}
			<button
				type="button"
				aria-label="Langkah berikutnya"
				disabled={view.page >= pages || loading}
				onclick={() => openPage(view.page + 1)}
			>
				<ChevronRight size={14} strokeWidth={2.4} />
			</button>
		</nav>
	{/if}

	{#if adding}
		<form
			class="flex flex-col gap-3 rounded-kanban border border-line bg-tint-2/50 p-3"
			onsubmit={save}
			novalidate
		>
			<StepFields bind:value {assignees} {errors} idPrefix="plan-{plan.id}" autofocus />
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="bf-btn bf-btn--secondary bf-btn--sm"
					onclick={() => (adding = false)}>Batal</button
				>
				<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm" disabled={saving}>
					{saving ? 'Menyimpan…' : 'Tambah'}
				</button>
			</div>
		</form>
	{:else}
		<div class="flex flex-wrap gap-2.5">
			<button
				type="button"
				class="bf-btn bf-btn--secondary bf-btn--sm"
				onclick={() => (adding = true)}
			>
				<Plus size={15} strokeWidth={2} />
				Tambah langkah
			</button>
			<!-- Asks the AI for suggestions on this plan (P2-02); they appear under Saran AI -->
			<button
				type="button"
				class="bf-btn bf-btn--ai bf-btn--sm"
				disabled={!onask || asking}
				title={onask ? 'Saran muncul di bagian Saran AI' : 'AI belum diatur'}
				onclick={ask}
			>
				<Sparkles size={15} strokeWidth={1.9} class={asking ? 'animate-pulse' : ''} />
				{asking ? 'Meminta saran…' : 'Minta saran AI'}
			</button>
		</div>
	{/if}
</article>
