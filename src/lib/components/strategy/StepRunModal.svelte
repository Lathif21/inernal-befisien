<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Modal from '#lib/components/Modal.svelte';
	import Field from '#lib/components/form/Field.svelte';
	import MoneyInput from '#lib/components/form/MoneyInput.svelte';
	import {
		CLIENT_SOURCE_LABELS,
		CLIENT_SOURCES,
		DEAL_STAGE_META,
		INDUSTRIES,
		INDUSTRY_LABELS,
		PAYMENT_METHOD_LABELS,
		PAYMENT_METHODS,
		SERVICE_TYPE_LABELS,
		SERVICE_TYPES
	} from '#lib/constants.ts';
	import { rupiah } from '#lib/format.ts';
	import {
		laterOpenStages,
		runProblem,
		RUN_KIND_LABELS,
		type RunDraft,
		type RunNext,
		type RunView
	} from '#lib/step-run.ts';
	import { toast } from '#lib/toast.ts';

	type Props = {
		/** The step to run; null = closed */
		stepId: string | null;
		onclose: () => void;
	};

	let { stepId, onclose }: Props = $props();

	let open = $state(false);
	let loading = $state(false);
	let loadError = $state('');
	type Of<K extends RunDraft['kind']> = Extract<RunDraft, { kind: K }>;

	let kind = $state<RunDraft['kind'] | null>(null);
	let view = $state<RunView | null>(null);
	// One typed state per kind, so the form fields bind with their own types
	let profile = $state<Of<'update_client'> | null>(null);
	let newDeal = $state<Of<'create_deal'> | null>(null);
	let move = $state<Of<'move_deal'> | null>(null);
	let payment = $state<Of<'record_payment'> | null>(null);
	let next = $state<RunNext>(null);
	/** MoneyInput works with number | null; copied into the run on Simpan */
	let money = $state<number | null>(null);
	let error = $state('');
	let busy = $state(false);

	// Each open fetches a fresh run: the data is checked again on the server
	$effect(() => {
		const id = stepId;
		open = !!id;
		if (!id) return;
		loading = true;
		loadError = '';
		error = '';
		kind = null;
		view = null;
		post('prepareStep', { stepId: id })
			.then((result) => {
				if (id !== stepId) return;
				if (result.type !== 'success') {
					loadError = String(
						(result.type === 'failure' && result.data?.error) ||
							'Langkah ini tidak bisa dijalankan.'
					);
					return;
				}
				const body = result.data?.prepared as { run: RunDraft; view: RunView };
				const r = body.run;
				profile = r.kind === 'update_client' ? r : null;
				newDeal = r.kind === 'create_deal' ? r : null;
				move = r.kind === 'move_deal' ? r : null;
				payment = r.kind === 'record_payment' ? r : null;
				money =
					r.kind === 'create_deal'
						? r.valueEstimate
						: r.kind === 'record_payment'
							? r.amount
							: null;
				next = r.next;
				view = body.view;
				kind = r.kind;
			})
			.catch(() => (loadError = 'Data langkah gagal dimuat. Coba lagi.'))
			.finally(() => (loading = false));
	});

	async function post(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const res = await fetch(`?/${action}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return deserialize(await res.text());
	}

	function close() {
		open = false;
		onclose();
	}

	/** The run as edited in the form */
	function current(): RunDraft | null {
		if (profile) return { ...profile, next };
		if (newDeal) return { ...newDeal, valueEstimate: money, next };
		if (move) return { ...move, next };
		if (payment) return { ...payment, amount: money ?? 0, next };
		return null;
	}

	async function save() {
		const draft = current();
		if (!draft || !stepId) return;
		const problem = runProblem(draft);
		if (problem) {
			error = problem;
			return;
		}
		busy = true;
		error = '';
		try {
			const result = await post('runStep', { stepId, run: JSON.stringify(draft) });
			if (result.type === 'success') {
				await invalidateAll();
				toast.success(String(result.data?.done ?? 'Tersimpan.'));
				close();
			} else if (result.type === 'failure') {
				error = String(result.data?.error ?? 'Aksi gagal dijalankan.');
			} else {
				error = 'Aksi gagal dijalankan.';
			}
		} catch {
			error = 'Aksi gagal dijalankan. Periksa koneksi lalu coba lagi.';
		} finally {
			busy = false;
		}
	}

	const stageLabel = (s: string | undefined) =>
		s ? DEAL_STAGE_META[s as keyof typeof DEAL_STAGE_META].label : '';
</script>

<Modal
	bind:open
	title={kind ? `Jalankan · ${RUN_KIND_LABELS[kind]}` : 'Jalankan langkah'}
	description={view ? `${view.clientName} · ${view.cardTitle}` : undefined}
	onclose={() => {
		if (!busy) onclose();
	}}
>
	{#if loading}
		<p class="text-body text-ink-2" role="status">Memuat data terbaru…</p>
	{:else if loadError}
		<p class="text-body text-danger" role="alert">{loadError}</p>
	{:else if kind && view}
		<form
			id="step-run-form"
			class="flex flex-col gap-4"
			novalidate
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<p class="text-small text-ink-2">
				Langkah: <span class="font-semibold text-ink">{view.stepTitle}</span>
			</p>
			{#if error}
				<p class="rounded-control bg-danger-bg px-3 py-2 text-small text-danger" role="alert">
					{error}
				</p>
			{/if}

			{#if profile}
				<div class="grid gap-4 sm:grid-cols-2">
					<Field label="Industri" name="run-industry">
						{#snippet children(attrs)}
							<select {...attrs} bind:value={profile!.industry}>
								<option value="">Belum diisi</option>
								{#each INDUSTRIES as v (v)}<option value={v}>{INDUSTRY_LABELS[v]}</option>{/each}
							</select>
						{/snippet}
					</Field>
					<Field label="Sumber" name="run-source">
						{#snippet children(attrs)}
							<select {...attrs} bind:value={profile!.source}>
								<option value="">Belum diisi</option>
								{#each CLIENT_SOURCES as v (v)}<option value={v}>{CLIENT_SOURCE_LABELS[v]}</option
									>{/each}
							</select>
						{/snippet}
					</Field>
					<Field label="Kota" name="run-city">
						{#snippet children(attrs)}
							<input {...attrs} bind:value={profile!.city} maxlength="80" />
						{/snippet}
					</Field>
					<Field label="Website" name="run-website">
						{#snippet children(attrs)}
							<input {...attrs} bind:value={profile!.website} maxlength="200" inputmode="url" />
						{/snippet}
					</Field>
				</div>
				<Field label="Catatan" name="run-notes">
					{#snippet children(attrs)}
						<textarea {...attrs} bind:value={profile!.notes} rows="3" maxlength="5000"></textarea>
					{/snippet}
				</Field>
				<Field
					label="Tambahan untuk Ringkasan konteks"
					name="run-context"
					hint="Kebutuhan, situasi, pengambil keputusan, anggaran. Ditambahkan di akhir ringkasan."
				>
					{#snippet children(attrs)}
						<textarea {...attrs} bind:value={profile!.contextAdd} rows="3" maxlength="2000"
						></textarea>
					{/snippet}
				</Field>
				{#if view.context}
					<details class="text-small text-ink-2">
						<summary class="cursor-pointer font-semibold">Ringkasan konteks sekarang</summary>
						<p class="mt-2 whitespace-pre-line">{view.context}</p>
					</details>
				{/if}
			{:else if newDeal}
				<Field label="Judul deal" name="run-title" required>
					{#snippet children(attrs)}
						<input {...attrs} bind:value={newDeal!.title} maxlength="150" />
					{/snippet}
				</Field>
				<div class="grid gap-4 sm:grid-cols-2">
					<Field label="Nilai estimasi" name="run-value">
						{#snippet children(attrs)}
							<MoneyInput
								id={attrs.id}
								name="run-value"
								bind:value={money}
								aria-describedby={attrs['aria-describedby']}
							/>
						{/snippet}
					</Field>
					<Field label="Layanan" name="run-service">
						{#snippet children(attrs)}
							<select {...attrs} bind:value={newDeal!.serviceType}>
								<option value="">Belum diisi</option>
								{#each SERVICE_TYPES as v (v)}<option value={v}>{SERVICE_TYPE_LABELS[v]}</option
									>{/each}
							</select>
						{/snippet}
					</Field>
				</div>
				<fieldset class="flex flex-col gap-4 rounded-kanban border border-line p-4">
					<legend class="px-1 text-small font-bold text-ink-2">Langkah pertama deal</legend>
					<Field label="Langkah" name="run-first-title" required>
						{#snippet children(attrs)}
							<input {...attrs} bind:value={newDeal!.firstStepTitle} maxlength="200" />
						{/snippet}
					</Field>
					<Field label="Tanggal & jam (WIB)" name="run-first-due" required>
						{#snippet children(attrs)}
							<input {...attrs} type="datetime-local" bind:value={newDeal!.firstStepDue} />
						{/snippet}
					</Field>
				</fieldset>
			{:else if move}
				<p class="text-body">
					Deal <span class="font-semibold">{view.dealTitle}</span>, sekarang di tahap
					<span class="font-semibold">{stageLabel(view.dealStage)}</span>.
				</p>
				<Field label="Pindahkan ke" name="run-to" required>
					{#snippet children(attrs)}
						<select {...attrs} bind:value={move!.to}>
							{#each laterOpenStages(view!.dealStage ?? 'lead') as s (s)}
								<option value={s}>{DEAL_STAGE_META[s].label}</option>
							{/each}
						</select>
					{/snippet}
				</Field>
			{:else if payment}
				<p class="text-body">
					Invoice <span class="font-semibold">{view.invoiceNumber}</span>, sisa tagihan
					<span class="font-semibold">{rupiah(view.remaining ?? 0)}</span>.
				</p>
				<div class="grid gap-4 sm:grid-cols-2">
					<Field label="Jumlah" name="run-amount" required>
						{#snippet children(attrs)}
							<MoneyInput
								id={attrs.id}
								name="run-amount"
								bind:value={money}
								aria-describedby={attrs['aria-describedby']}
							/>
						{/snippet}
					</Field>
					<Field label="Tanggal bayar" name="run-date" required>
						{#snippet children(attrs)}
							<input {...attrs} type="date" bind:value={payment!.date} />
						{/snippet}
					</Field>
				</div>
				<Field
					label="Metode"
					name="run-method"
					hint="Dicatat sebagai pemasukan dibayar, kategori {view.categoryName}."
				>
					{#snippet children(attrs)}
						<select {...attrs} bind:value={payment!.method}>
							{#each PAYMENT_METHODS as v (v)}<option value={v}>{PAYMENT_METHOD_LABELS[v]}</option
								>{/each}
						</select>
					{/snippet}
				</Field>
			{/if}

			{#if next}
				<fieldset class="flex flex-col gap-4 rounded-kanban border border-line p-4">
					<legend class="px-1 text-small font-bold text-ink-2">Langkah berikutnya</legend>
					<p class="text-small text-ink-2">
						Ini langkah terbuka terakhir di kartu ini, jadi tambahkan langkah berikutnya.
					</p>
					<Field label="Langkah" name="run-next-title" required>
						{#snippet children(attrs)}
							<input {...attrs} bind:value={next!.title} maxlength="200" />
						{/snippet}
					</Field>
					<Field label="Tanggal & jam (WIB)" name="run-next-due" required>
						{#snippet children(attrs)}
							<input {...attrs} type="datetime-local" bind:value={next!.due} />
						{/snippet}
					</Field>
				</fieldset>
			{/if}
		</form>
	{/if}

	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" disabled={busy} onclick={close}>
			Batal
		</button>
		{#if kind && !loadError}
			<button type="submit" form="step-run-form" class="bf-btn bf-btn--primary" disabled={busy}>
				{busy ? 'Menjalankan…' : 'Simpan & tandai selesai'}
			</button>
		{/if}
	{/snippet}
</Modal>
