<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
	import Field from '#lib/components/form/Field.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import {
		DEAL_STAGE_META,
		PROJECT_STAGE_META,
		type DealStage,
		type ProjectStage
	} from '#lib/constants.ts';
	import type { FormMessage } from '#lib/schemas/message.ts';
	import type { PlanInput } from '#lib/schemas/plan.ts';
	import { toast } from '#lib/toast.ts';

	type CardOption = { id: string; title: string; clientName: string };

	type Props = {
		form: SuperValidated<PlanInput, FormMessage>;
		cards: {
			deals: (CardOption & { stage: DealStage })[];
			projects: (CardOption & { stage: ProjectStage })[];
		};
	};

	let { form: initial, cards }: Props = $props();

	let open = $state(false);
	let editingGoal = $state<string | null>(null);

	const { form, errors, enhance, submitting, message, reset } = superForm(
		untrack(() => initial),
		{
			id: 'plan-form',
			onUpdated({ form }) {
				if (form.message?.type === 'success') {
					open = false;
					toast.success(form.message.text);
				}
			}
		}
	);

	export function openCreate() {
		editingGoal = null;
		reset();
		open = true;
	}

	export function openEdit(p: {
		id: string;
		goal: string;
		targetDate: string | null;
		notes: string | null;
	}) {
		editingGoal = p.goal;
		reset({
			data: { id: p.id, goal: p.goal, targetDate: p.targetDate ?? '', notes: p.notes ?? '' }
		});
		open = true;
	}
</script>

<Drawer
	bind:open
	title={editingGoal ? 'Ubah rencana' : 'Rencana baru'}
	description={editingGoal ?? 'Tujuan dan langkah untuk satu deal atau proyek.'}
>
	<form
		id="plan-form"
		method="post"
		action="?/savePlan"
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

		{#if !$form.id}
			<Field
				label="Untuk deal atau proyek"
				name="card"
				required
				errors={$errors.card}
				hint="Langkah rencana muncul di kartu ini"
			>
				{#snippet children(attrs)}
					<select {...attrs} bind:value={$form.card}>
						<option value="">Pilih deal atau proyek</option>
						{#if cards.deals.length}
							<optgroup label="Deal">
								{#each cards.deals as d (d.id)}
									<option value="deal:{d.id}"
										>{d.clientName} · {d.title} ({DEAL_STAGE_META[d.stage].label})</option
									>
								{/each}
							</optgroup>
						{/if}
						{#if cards.projects.length}
							<optgroup label="Proyek">
								{#each cards.projects as p (p.id)}
									<option value="project:{p.id}"
										>{p.clientName} · {p.title} ({PROJECT_STAGE_META[p.stage].label})</option
									>
								{/each}
							</optgroup>
						{/if}
					</select>
				{/snippet}
			</Field>
		{/if}

		<Field label="Tujuan" name="goal" required errors={$errors.goal}>
			{#snippet children(attrs)}
				<input
					{...attrs}
					bind:value={$form.goal}
					maxlength="200"
					placeholder="Closing AI Agent pengadaan sebelum 30 Nov"
				/>
			{/snippet}
		</Field>
		<Field label="Target tanggal" name="targetDate" errors={$errors.targetDate}>
			{#snippet children(attrs)}
				<input {...attrs} type="date" bind:value={$form.targetDate} />
			{/snippet}
		</Field>
		<Field label="Catatan" name="notes" errors={$errors.notes}>
			{#snippet children(attrs)}
				<textarea {...attrs} bind:value={$form.notes} rows="3" maxlength="2000"></textarea>
			{/snippet}
		</Field>
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form="plan-form" class="bf-btn bf-btn--primary" disabled={$submitting}>
			{$submitting ? 'Menyimpan…' : 'Simpan rencana'}
		</button>
	{/snippet}
</Drawer>
