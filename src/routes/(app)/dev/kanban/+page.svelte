<script lang="ts">
	import { generateKeyBetween } from 'fractional-indexing';
	import KanbanBoard, { type KanbanColumn } from '#lib/components/kanban/KanbanBoard.svelte';
	import KanbanCard from '#lib/components/kanban/KanbanCard.svelte';
	import MoveMenu from '#lib/components/kanban/MoveMenu.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		DEAL_STAGE_META,
		DEAL_STAGES,
		SERVICE_TYPE_LABELS,
		type DealStage,
		type ServiceType
	} from '#lib/constants.ts';
	import { rupiahShort } from '#lib/format.ts';
	import { toLanes, type KanbanMove, type Lanes } from '#lib/kanban.ts';
	import { toast } from '#lib/toast.ts';

	// Fake data only (development page for P1-05). The real boards come in P1-06 / P1-08.
	type DemoDeal = {
		id: string;
		stage: DealStage;
		position: string;
		client: string;
		title: string;
		service: ServiceType;
		value: number;
		owner: string;
		days: number;
		next: string;
	};

	const seed: Omit<DemoDeal, 'position'>[] = [
		{
			id: 'd1',
			stage: 'lead',
			client: 'PT Mitra Energi',
			title: 'AI monitoring PLTS',
			service: 'energy_ai',
			value: 120_000_000,
			owner: 'Befisien',
			days: 2,
			next: 'Kirim profil perusahaan'
		},
		{
			id: 'd2',
			stage: 'lead',
			client: 'PT Sinar Pangan',
			title: 'Dashboard produksi',
			service: 'dashboard_app',
			value: 45_000_000,
			owner: 'Befisien',
			days: 5,
			next: 'Telepon kualifikasi'
		},
		{
			id: 'd3',
			stage: 'contacted',
			client: 'Yayasan Bina Cendekia',
			title: 'Website sekolah',
			service: 'web_cms',
			value: 28_000_000,
			owner: 'Befisien',
			days: 4,
			next: 'Jadwalkan demo'
		},
		{
			id: 'd4',
			stage: 'meeting',
			client: 'PT Artha Finansial',
			title: 'AI Agent layanan nasabah',
			service: 'ai_agent',
			value: 180_000_000,
			owner: 'Befisien',
			days: 6,
			next: 'Demo ke tim digital'
		},
		{
			id: 'd5',
			stage: 'meeting',
			client: 'CV Garuda Manufaktur',
			title: 'Otomasi purchase order',
			service: 'automation',
			value: 38_000_000,
			owner: 'Befisien',
			days: 12,
			next: 'Kirim ringkasan meeting'
		},
		{
			id: 'd6',
			stage: 'proposal',
			client: 'PT Surya Daya Mandiri',
			title: 'AI Agent pengadaan barang',
			service: 'ai_agent',
			value: 150_000_000,
			owner: 'Befisien',
			days: 8,
			next: 'Follow up proposal via WA'
		},
		{
			id: 'd7',
			stage: 'negotiation',
			client: 'PT Artha Finansial',
			title: 'Dashboard risiko kredit',
			service: 'dashboard_app',
			value: 210_000_000,
			owner: 'Befisien',
			days: 5,
			next: 'Negosiasi termin'
		},
		{
			id: 'd8',
			stage: 'won',
			client: 'PT Surya Daya Mandiri',
			title: 'Integrasi SCADA',
			service: 'integration',
			value: 135_000_000,
			owner: 'Befisien',
			days: 18,
			next: ''
		},
		{
			id: 'd9',
			stage: 'lost',
			client: 'Kopi Kenangan Senja',
			title: 'Aplikasi loyalitas',
			service: 'dashboard_app',
			value: 25_000_000,
			owner: 'Befisien',
			days: 20,
			next: ''
		}
	];

	// Positions per column, like the server will store them
	function withPositions(items: Omit<DemoDeal, 'position'>[]): DemoDeal[] {
		const out: DemoDeal[] = [];
		for (const stage of DEAL_STAGES) {
			let prev: string | null = null;
			for (const d of items.filter((x) => x.stage === stage)) {
				prev = generateKeyBetween(prev, null);
				out.push({ ...d, position: prev });
			}
		}
		return out;
	}
	let deals = $state<DemoDeal[]>(withPositions(seed));

	const columns: KanbanColumn[] = DEAL_STAGES.map((s) => ({
		key: s,
		label: DEAL_STAGE_META[s].label,
		dot: DEAL_STAGE_META[s].dot,
		collapsed: s === 'won' || s === 'lost',
		note: s === 'won' || s === 'lost' ? '30 hari terakhir' : undefined
	}));

	const lanes: Lanes<DemoDeal> = $derived(
		toLanes(
			[...deals].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)),
			DEAL_STAGES,
			(d) => d.stage
		)
	);

	let failSaves = $state(false);
	let log = $state<string[]>([]);

	/** Stand-in for the server: wait, then compute the position from the neighbours */
	async function onMove(move: KanbanMove) {
		await new Promise((r) => setTimeout(r, 600));
		if (failSaves) throw new Error('Simulasi: server menolak perpindahan. Kartu dikembalikan.');
		const pos = (id: string | null) => (id ? deals.find((d) => d.id === id)!.position : null);
		const position = generateKeyBetween(pos(move.beforeId), pos(move.afterId));
		deals = deals.map((d) =>
			d.id === move.id ? { ...d, stage: move.to as DealStage, position, days: 0 } : d
		);
		const title = deals.find((d) => d.id === move.id)!.title;
		log = [
			`${title}: ${DEAL_STAGE_META[move.from as DealStage].label} → ${DEAL_STAGE_META[move.to as DealStage].label} · di bawah ${move.beforeId ?? '–'}, di atas ${move.afterId ?? '–'} · posisi ${position}`,
			...log
		].slice(0, 8);
		toast.success(`${title} dipindahkan.`);
	}
</script>

<Topbar title="Demo Kanban" />

<!-- boards use the full window width -->
<main class="page-body max-w-none!">
	<section class="flex flex-wrap items-center gap-4 rounded-card bg-surface p-4 text-small">
		<p class="min-w-0 flex-1 text-ink-2">
			Data contoh untuk komponen Kanban (P1-05). Seret kartu, atau pakai menu "⋯" → Pindah ke…
		</p>
		<label class="inline-flex min-h-(--size-touch) items-center gap-2 font-bold">
			<input type="checkbox" bind:checked={failSaves} class="size-5 accent-danger-fill" />
			Simulasikan gagal simpan
		</label>
	</section>

	<KanbanBoard
		label="Demo Pipeline"
		{columns}
		{lanes}
		itemLabel={(d) => d.title}
		total={(items) => (items.length ? rupiahShort(items.reduce((s, d) => s + d.value, 0)) : null)}
		{onMove}
		type="demo-deal"
	>
		{#snippet card(d, ctx)}
			<KanbanCard
				client={d.client}
				service={SERVICE_TYPE_LABELS[d.service]}
				title={d.title}
				value={rupiahShort(d.value)}
				owner={d.owner}
				daysInStage={d.days}
				onopen={() => toast.info(`Drawer untuk "${d.title}" dibuat di P1-06.`)}
			>
				{#snippet next()}
					{#if d.next}
						<div class="bf-next bf-next--upcoming">
							<span>
								<span class="bf-next__title">{d.next}</span>
								<span class="bf-next__when">Langkah berikutnya (P1-07)</span>
							</span>
						</div>
					{/if}
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

	<section class="flex flex-col gap-2 rounded-card bg-surface p-4" aria-label="Log perpindahan">
		<h2 class="text-section-title">Log perpindahan</h2>
		{#if log.length === 0}
			<p class="text-small text-ink-3">Belum ada perpindahan.</p>
		{:else}
			<ol class="flex flex-col gap-1 font-mono text-[12px]" data-testid="move-log">
				{#each log as line, i (i)}<li>{line}</li>{/each}
			</ol>
		{/if}
	</section>
</main>
