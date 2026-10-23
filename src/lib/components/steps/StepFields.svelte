<script lang="ts">
	import Field from '#lib/components/form/Field.svelte';
	import { QUICK_DATES, wibDatePlus, type StepValue } from '#lib/step-form.ts';

	type Props = {
		value: StepValue;
		assignees: { id: string; name: string }[];
		/** Field errors from the server */
		errors?: Record<string, string>;
		/** Unique per form on the page, keeps label / input ids distinct */
		idPrefix: string;
		/** Focus the title when shown */
		autofocus?: boolean;
	};

	let {
		value = $bindable(),
		assignees,
		errors = {},
		idPrefix,
		autofocus = false
	}: Props = $props();
	const err = (k: string) => (errors[k] ? [errors[k]] : undefined);
</script>

<!-- StepForm fields: date + time in WIB, quick dates, person responsible (docs/05-PHASES.md P1-07) -->
<div class="flex flex-col gap-3">
	<Field label="Langkah" name="{idPrefix}-title" required errors={err('title')}>
		{#snippet children(attrs)}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				{...attrs}
				bind:value={value.title}
				maxlength="200"
				placeholder="Contoh: Follow up proposal via WA"
				{autofocus}
			/>
		{/snippet}
	</Field>

	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Tanggal cepat">
		{#each QUICK_DATES as q (q.days)}
			<button
				type="button"
				class={[
					'bf-btn bf-btn--sm min-h-8! px-3! text-[12.5px]!',
					value.dueDate === wibDatePlus(q.days) ? 'bf-btn--primary' : 'bf-btn--secondary'
				]}
				aria-pressed={value.dueDate === wibDatePlus(q.days)}
				onclick={() => (value.dueDate = wibDatePlus(q.days))}>{q.label}</button
			>
		{/each}
	</div>

	<div class="grid grid-cols-2 gap-3">
		<Field label="Tanggal" name="{idPrefix}-dueDate" required errors={err('dueDate')}>
			{#snippet children(attrs)}
				<input {...attrs} type="date" bind:value={value.dueDate} />
			{/snippet}
		</Field>
		<Field
			label="Jam (WIB)"
			name="{idPrefix}-dueTime"
			required={!value.allDay}
			errors={err('dueTime')}
		>
			{#snippet children(attrs)}
				<input
					{...attrs}
					type="time"
					bind:value={value.dueTime}
					disabled={value.allDay}
					step="300"
				/>
			{/snippet}
		</Field>
	</div>

	<label class="inline-flex min-h-9 items-center gap-2 text-small font-semibold text-ink-2">
		<input type="checkbox" bind:checked={value.allDay} class="size-4.5 accent-accent" />
		Sepanjang hari (tanpa jam)
	</label>

	<Field
		label="Penanggung jawab"
		name="{idPrefix}-assigneeId"
		errors={err('assigneeId')}
		hint="Kosong = pemilik kartu"
	>
		{#snippet children(attrs)}
			<select {...attrs} bind:value={value.assigneeId}>
				<option value="">Pemilik kartu</option>
				{#each assignees as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
			</select>
		{/snippet}
	</Field>
</div>
