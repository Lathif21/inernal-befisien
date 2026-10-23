<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Download from '@lucide/svelte/icons/download';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { DEAL_STAGE_META, type DealStage } from '#lib/constants.ts';
	import { IMPORT_COLUMNS } from '#lib/import/client-csv.ts';
	import { rupiah } from '#lib/format.ts';
	import type { ImportSummary, PreviewLine } from '#lib/server/services/import.ts';
	import { toast } from '#lib/toast.ts';

	type Preview = {
		lines: PreviewLine[];
		fileErrors: string[];
		unknownColumns: string[];
		valid: number;
		invalid: number;
	};

	let preview = $state<{ fileName: string; text: string; data: Preview } | null>(null);
	let summary = $state<ImportSummary | null>(null);
	let busy = $state(false);
	let onlyProblems = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	const lines = $derived(
		preview ? preview.data.lines.filter((l) => !onlyProblems || !l.row || l.warnings.length) : []
	);
	const newClients = $derived(preview?.data.lines.filter((l) => l.match === 'new').length ?? 0);
	const existing = $derived(preview?.data.lines.filter((l) => l.match === 'existing').length ?? 0);

	/** Both steps stay on this page: results come back as action data, nothing to reload */
	const submit =
		(step: 'preview' | 'import'): SubmitFunction =>
		() => {
			busy = true;
			return async ({ result }) => {
				busy = false;
				if (result.type === 'failure') {
					toast.error(String(result.data?.error ?? 'Terjadi kesalahan.'));
					return;
				}
				if (result.type === 'error') {
					toast.error('Terjadi kesalahan. Coba lagi.');
					return;
				}
				if (result.type !== 'success' || !result.data) return;
				if (step === 'preview') {
					summary = null;
					onlyProblems = false;
					preview = {
						fileName: String(result.data.fileName),
						text: String(result.data.text),
						data: result.data.preview as Preview
					};
				} else {
					summary = result.data.summary as ImportSummary;
					preview = null;
					if (fileInput) fileInput.value = '';
					toast.success(`${summary.rows} baris diimpor.`);
				}
			};
		};

	const MATCH = {
		new: { label: 'Klien baru', chip: 'bf-chip--success' },
		existing: { label: 'Sudah ada', chip: 'bf-chip--accent' },
		repeat: { label: 'Baris sebelumnya', chip: '' }
	} as const;
	const stageLabel = (s: string | undefined) =>
		s && s.toLowerCase() in DEAL_STAGE_META
			? DEAL_STAGE_META[s.toLowerCase() as DealStage].label
			: s;
</script>

<Topbar title="Import Data" />

<main class="page-body gap-5!">
	<a
		href={resolve('settings')}
		class="inline-flex w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Pengaturan
	</a>

	<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-labelledby="step-1">
		<h2 id="step-1" class="text-section-title">1. Siapkan file</h2>
		<p class="max-w-3xl text-body text-ink-2">
			Satu baris per klien. Klien dengan nama yang sama tidak dibuat dua kali: kontak dan deal
			ditambahkan ke klien itu. Deal ✓ (won) langsung membuat proyek. Riwayat pembayaran dicatat di
			Keuangan, bukan di file ini.
		</p>
		<div class="flex flex-wrap items-center gap-3">
			<a href={resolve('settings/import/template.csv')} class="bf-btn bf-btn--secondary" download>
				<Download size={16} strokeWidth={2} />
				Unduh template CSV
			</a>
			<details class="text-small">
				<summary class="cursor-pointer font-bold text-accent-ink">Daftar kolom</summary>
				<p class="mt-2 max-w-3xl font-mono text-[12.5px] text-ink-2">{IMPORT_COLUMNS.join(', ')}</p>
				<p class="mt-1 max-w-3xl text-ink-2">
					Wajib: <b>client_name</b>; <b>deal_stage</b> jika ada deal_title;
					<b>next_action_due</b> (YYYY-MM-DD atau YYYY-MM-DD HH:MM, WIB) jika ada next_action.
				</p>
			</details>
		</div>
	</section>

	<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-labelledby="step-2">
		<h2 id="step-2" class="text-section-title">2. Unggah dan periksa</h2>
		<form
			method="post"
			action="?/preview"
			enctype="multipart/form-data"
			use:enhance={submit('preview')}
			class="flex flex-wrap items-end gap-3"
		>
			<label class="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5 text-small font-bold text-ink-2">
				File CSV (maks. 1 MB, UTF-8)
				<input
					bind:this={fileInput}
					type="file"
					name="file"
					accept=".csv,text/csv"
					required
					class="min-h-11 rounded-control border border-line bg-surface px-3 py-2 text-body font-medium text-ink file:mr-3 file:rounded-[8px] file:border-0 file:bg-tint-2 file:px-3 file:py-1 file:font-bold file:text-ink"
				/>
			</label>
			<button type="submit" class="bf-btn bf-btn--primary" disabled={busy}>
				<Upload size={16} strokeWidth={2} />
				{busy && !preview ? 'Memeriksa…' : 'Pratinjau'}
			</button>
		</form>
	</section>

	{#if preview}
		{@const p = preview.data}
		<section
			class="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-5"
			aria-labelledby="step-3"
		>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 id="step-3" class="text-section-title">3. Pratinjau · {preview.fileName}</h2>
				{#if p.lines.length}
					<label class="inline-flex items-center gap-2 text-small font-semibold text-ink-2">
						<input type="checkbox" bind:checked={onlyProblems} class="size-4 accent-accent" />
						Hanya baris bermasalah
					</label>
				{/if}
			</div>

			{#each p.fileErrors as e (e)}
				<p
					role="alert"
					class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
				>
					{e}
				</p>
			{/each}

			{#if p.lines.length}
				<p class="flex flex-wrap gap-2" aria-live="polite">
					<span class="bf-chip bf-chip--success">{p.valid} baris siap diimpor</span>
					{#if p.invalid}<span class="bf-chip bf-chip--danger"
							>{p.invalid} baris bermasalah, dilewati</span
						>{/if}
					<span class="bf-chip">{newClients} klien baru · {existing} sudah ada</span>
				</p>
				{#if p.unknownColumns.length}
					<p class="text-small text-ink-2">
						Kolom tidak dikenal diabaikan: <span class="font-mono"
							>{p.unknownColumns.join(', ')}</span
						>
					</p>
				{/if}

				<div class="bf-table-wrap max-h-[60vh] min-w-0 overflow-y-auto">
					<table class="bf-table min-w-220">
						<thead class="sticky top-0 z-1 bg-surface">
							<tr>
								<th scope="col">Baris</th>
								<th scope="col">Klien</th>
								<th scope="col">Kontak</th>
								<th scope="col">Deal</th>
								<th scope="col">Langkah berikutnya</th>
								<th scope="col">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each lines as l (l.line)}
								<tr class={[!l.row && 'bg-danger-bg/50']}>
									<td class="font-mono text-[12.5px]">{l.line}</td>
									<td>
										<span class="font-bold">{l.raw.client_name || '–'}</span>
										{#if l.match}<span class={['bf-chip ml-1', MATCH[l.match].chip]}
												>{MATCH[l.match].label}</span
											>{/if}
									</td>
									<td>
										{l.raw.contact_name || '–'}
										{#if l.raw.contact_phone || l.raw.contact_email}
											<span class="block text-small text-ink-3"
												>{[l.raw.contact_phone, l.raw.contact_email]
													.filter(Boolean)
													.join(' · ')}</span
											>
										{/if}
									</td>
									<td>
										{#if l.raw.deal_title}
											{l.raw.deal_title}
											<span class="block text-small text-ink-3"
												>{stageLabel(l.raw.deal_stage) || '–'}{l.row?.deal?.value
													? ` · ${rupiah(l.row.deal.value)}`
													: ''}</span
											>
										{:else}–{/if}
									</td>
									<td>
										{l.raw.next_action || '–'}
										{#if l.raw.next_action_due}<span class="block text-small text-ink-3"
												>{l.raw.next_action_due}</span
											>{/if}
									</td>
									<td class="min-w-60">
										{#if l.row}
											<span class="inline-flex items-center gap-1 font-bold text-success"
												><CircleCheck size={15} strokeWidth={2} aria-hidden="true" /> Siap</span
											>
										{/if}
										{#each l.errors as e (e)}
											<span class="flex items-start gap-1 text-small font-semibold text-danger"
												><CircleAlert
													size={14}
													strokeWidth={2}
													class="mt-0.5 shrink-0"
													aria-hidden="true"
												/>{e}</span
											>
										{/each}
										{#each l.warnings as w (w)}
											<span class="flex items-start gap-1 text-small font-semibold text-warning"
												><TriangleAlert
													size={14}
													strokeWidth={2}
													class="mt-0.5 shrink-0"
													aria-hidden="true"
												/>{w}</span
											>
										{/each}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<form
				method="post"
				action="?/import"
				use:enhance={submit('import')}
				class="flex flex-wrap items-center justify-end gap-3"
			>
				<input type="hidden" name="text" value={preview.text} />
				<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (preview = null)}
					>Batal</button
				>
				<button type="submit" class="bf-btn bf-btn--primary" disabled={busy || p.valid === 0}>
					{busy ? 'Mengimpor…' : `Impor ${p.valid} baris`}
				</button>
			</form>
		</section>
	{/if}

	{#if summary}
		<section
			class="flex flex-col gap-3 rounded-card bg-success-bg p-5"
			aria-labelledby="result"
			role="status"
		>
			<h2 id="result" class="text-section-title text-success">Impor selesai</h2>
			<ul class="grid gap-x-8 gap-y-1 text-body sm:grid-cols-2">
				<li>
					<b>{summary.rows}</b> baris diimpor{summary.skippedRows
						? `, ${summary.skippedRows} dilewati`
						: ''}
				</li>
				<li>
					<b>{summary.clientsCreated}</b> klien baru, <b>{summary.clientsMatched}</b> klien yang sudah
					ada
				</li>
				<li>
					<b>{summary.contactsAdded}</b> kontak ditambahkan{summary.contactsSkipped
						? ` (${summary.contactsSkipped} sudah ada)`
						: ''}
				</li>
				<li>
					<b>{summary.dealsCreated}</b> deal dibuat{summary.dealsSkipped
						? ` (${summary.dealsSkipped} sudah ada)`
						: ''},
					<b>{summary.projectsCreated}</b> proyek
				</li>
			</ul>
			<div class="flex flex-wrap gap-2">
				<a href={resolve('clients')} class="bf-btn bf-btn--secondary bf-btn--sm">Lihat klien</a>
				<a href={resolve('pipeline')} class="bf-btn bf-btn--secondary bf-btn--sm"
					>Buka Pipeline Sales</a
				>
			</div>
		</section>
	{/if}
</main>
