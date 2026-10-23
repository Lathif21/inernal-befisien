<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Avatar from '#lib/components/Avatar.svelte';
	import StepFields from '#lib/components/steps/StepFields.svelte';
	import { dateID } from '#lib/format.ts';
	import { nextActionState, nextActionWhen } from '#lib/next-action.ts';
	import { newStepValue, stepValueOf, type StepValue } from '#lib/step-form.ts';

	export type PanelStep = {
		id: string;
		title: string;
		dueAt: Date | string;
		allDay: boolean;
		assigneeId: string | null;
		assigneeName: string | null;
		doneAt: Date | string | null;
	};

	type Props = {
		steps: { open: PanelStep[]; done: PanelStep[] };
		assignees: { id: string; name: string }[];
		now?: Date;
		/** Read only (archived client / closed card without edits) */
		readonly?: boolean;
		/** Tick off; the page decides whether to ask for the next step */
		oncomplete: (step: PanelStep) => void;
		/** Save a new (`id` null) or edited step; resolves to field errors, or nothing when saved */
		onsave: (id: string | null, value: StepValue) => Promise<Record<string, string> | void>;
	};

	let {
		steps,
		assignees,
		now = new Date(),
		readonly = false,
		oncomplete,
		onsave
	}: Props = $props();

	/** The step being edited, 'new' for the add form, or null */
	let editing = $state<string | 'new' | null>(null);
	let value = $state<StepValue>(newStepValue());
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);

	function startAdd() {
		value = newStepValue();
		errors = {};
		editing = 'new';
	}
	function startEdit(s: PanelStep) {
		value = stepValueOf({ ...s, dueAt: new Date(s.dueAt) });
		errors = {};
		editing = s.id;
	}
	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		try {
			const result = await onsave(editing === 'new' ? null : editing, value);
			if (result) errors = result;
			else editing = null;
		} finally {
			saving = false;
		}
	}

	const STATE_TEXT = {
		late: 'text-danger',
		today: 'text-warning',
		upcoming: 'text-ink-2'
	} as const;
</script>

{#snippet stepForm(id: string)}
	<form
		class="flex flex-col gap-3 rounded-kanban border border-line bg-tint-2/50 p-3"
		onsubmit={save}
		novalidate
	>
		<StepFields bind:value {assignees} {errors} idPrefix={id} autofocus />
		<div class="flex justify-end gap-2">
			<button
				type="button"
				class="bf-btn bf-btn--secondary bf-btn--sm"
				onclick={() => (editing = null)}>Batal</button
			>
			<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm" disabled={saving}>
				{saving ? 'Menyimpan…' : 'Simpan langkah'}
			</button>
		</div>
	</form>
{/snippet}

<!-- Steps of one deal / project: open ones earliest first (the first is the card's next action) -->
<div class="flex flex-col gap-3">
	{#if steps.open.length === 0}
		<p class="rounded-control bg-tint-2 px-3 py-3 text-small text-ink-2">
			Belum ada langkah terbuka.
		</p>
	{:else}
		<ul class="flex flex-col">
			{#each steps.open as s, i (s.id)}
				{@const due = new Date(s.dueAt)}
				{@const state = nextActionState(due, now, s.allDay)}
				<li class="border-t border-tint-2 py-2.5 first:border-t-0 first:pt-0">
					{#if editing === s.id}
						{@render stepForm(`step-${s.id}`)}
					{:else}
						<div class="flex items-start gap-3">
							{#if !readonly}
								<button
									type="button"
									class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-line-strong text-transparent hover:border-success-fill hover:text-success-fill"
									aria-label="Tandai selesai: {s.title}"
									title="Tandai selesai"
									onclick={() => oncomplete(s)}
								>
									<Check size={14} strokeWidth={3} />
								</button>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="font-bold break-words">
									{s.title}
									{#if i === 0}<span class="bf-chip ml-1 align-middle">Berikutnya</span>{/if}
								</p>
								<p class={['font-mono text-[12px] font-medium', STATE_TEXT[state]]}>
									{nextActionWhen(due, now, s.allDay)}
								</p>
							</div>
							{#if s.assigneeName}<Avatar name={s.assigneeName} size={24} />{/if}
							{#if !readonly}
								<button
									type="button"
									class="bf-icon-btn size-8! shrink-0"
									aria-label="Ubah langkah: {s.title}"
									onclick={() => startEdit(s)}
								>
									<Pencil size={14} strokeWidth={1.75} />
								</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if !readonly}
		{#if editing === 'new'}
			{@render stepForm('step-new')}
		{:else}
			<button type="button" class="bf-btn bf-btn--secondary bf-btn--sm w-fit" onclick={startAdd}>
				<Plus size={15} strokeWidth={2} />
				Tambah langkah
			</button>
		{/if}
	{/if}

	{#if steps.done.length}
		<details class="text-small">
			<summary class="cursor-pointer font-bold text-ink-2"
				>Selesai ({steps.done.length} terakhir)</summary
			>
			<ul class="mt-2 flex flex-col gap-1.5">
				{#each steps.done as s (s.id)}
					<li class="flex items-baseline gap-2 text-ink-3">
						<Check
							size={13}
							strokeWidth={2.6}
							class="shrink-0 text-success-fill"
							aria-hidden="true"
						/>
						<span class="min-w-0 flex-1 line-through">{s.title}</span>
						{#if s.doneAt}<span class="font-mono text-[11.5px]"
								>{dateID(new Date(s.doneAt), 'datetime')}</span
							>{/if}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
