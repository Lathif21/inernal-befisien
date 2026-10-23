<script lang="ts">
	import { rupiah, rupiahShort } from '#lib/format.ts';

	export type BarGroup = {
		key: string;
		/** Axis label; long ones wrap to two lines */
		label: string;
		/** Tooltip and table heading, e.g. the full client name or "19 – 25 Okt 2026" */
		title: string;
		income: number;
		expense: number;
		/** The selected period: label in bold */
		current?: boolean;
	};

	type Props = {
		groups: BarGroup[];
		/** Accessible name, e.g. "Pemasukan vs Pengeluaran per bulan" */
		label: string;
		height?: number;
	};

	let { groups, label, height = 280 }: Props = $props();

	// Two series from the design system: chart-income (accent) beside chart-expense (navy)
	const SERIES = [
		{
			key: 'income',
			name: 'Pemasukan',
			fill: 'fill-chart-income',
			bg: 'bg-chart-income',
			sign: '+'
		},
		{
			key: 'expense',
			name: 'Pengeluaran',
			fill: 'fill-chart-expense',
			bg: 'bg-chart-expense',
			sign: '−'
		}
	] as const;

	const M = { top: 12, right: 8, bottom: 44, left: 52 };
	/** Mark specs (dataviz): bars at most 24px, 4px rounded data-end, 2px surface gap */
	const MAX_BAR = 24;
	const GAP = 2;
	/** Narrowest group before the chart scrolls sideways inside its own box (phones) */
	const MIN_GROUP = 56;

	let boxWidth = $state(0);
	const width = $derived(Math.max(boxWidth, M.left + M.right + groups.length * MIN_GROUP));
	const inner = $derived({ w: width - M.left - M.right, h: height - M.top - M.bottom });
	const band = $derived(groups.length ? inner.w / groups.length : inner.w);
	const bar = $derived(Math.max(4, Math.min(MAX_BAR, (band * 0.7 - GAP) / 2)));

	/** Clean steps: 1, 2, 2.5, 5 × 10ⁿ, about four gridlines */
	const ticks = $derived.by(() => {
		const max = Math.max(0, ...groups.flatMap((g) => [g.income, g.expense]));
		if (max === 0) return [0, 1_000_000];
		const raw = max / 4;
		const mag = 10 ** Math.floor(Math.log10(raw));
		const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
		return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
	});
	const top = $derived(ticks.at(-1)!);
	const y = (v: number) => M.top + inner.h - (v / top) * inner.h;
	const empty = $derived(groups.every((g) => g.income === 0 && g.expense === 0));

	/** Axis ticks: "0", "500 rb", "20 jt", "1,5 M" */
	function tick(v: number) {
		if (v === 0) return '0';
		if (v < 1e6) return `${Math.round(v / 1e3)} rb`;
		return rupiahShort(v).replace(/^Rp\s/, '');
	}

	/** Bar with a 4px rounded top, square at the baseline */
	function barPath(x: number, v: number) {
		const h = inner.h - (y(v) - M.top);
		if (h <= 0) return '';
		const r = Math.min(4, h, bar / 2);
		const yTop = y(v);
		const base = M.top + inner.h;
		return `M${x},${base}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bar - r}Q${x + bar},${yTop} ${x + bar},${yTop + r}V${base}Z`;
	}

	/** Up to two lines, cut with "…" (measured roughly at 6.6px per character, 12px font) */
	function lines(text: string) {
		const max = Math.max(4, Math.floor((band - 6) / 6.6));
		if (text.length <= max) return [text];
		const words = text.split(' ');
		let first = '';
		while (words.length && (first ? `${first} ${words[0]}` : words[0]).length <= max)
			first = first ? `${first} ${words.shift()}` : words.shift()!;
		if (!first) first = words.shift()!.slice(0, max);
		let second = words.join(' ');
		if (second.length > max) second = `${second.slice(0, max - 1)}…`;
		return second ? [first, second] : [first];
	}

	let active = $state<number | null>(null);
	const tip = $derived(active === null ? null : groups[active]);
	const tipLeft = $derived(
		active === null ? 0 : Math.min(Math.max(M.left + band * (active + 0.5), 90), width - 90)
	);
	const describe = (g: BarGroup) =>
		`${g.title}: Pemasukan ${rupiah(g.income)}, Pengeluaran ${rupiah(g.expense)}`;
</script>

<div class="flex flex-col gap-3">
	<!-- Legend: always present for two series; the mark beside the text carries the colour -->
	<ul class="flex flex-wrap gap-4 text-small font-semibold text-ink-2" aria-hidden="true">
		{#each SERIES as s (s.key)}
			<li class="inline-flex items-center gap-2">
				<span class={['inline-block size-3 rounded-[3px]', s.bg]}></span>{s.name}
			</li>
		{/each}
	</ul>

	<div class="relative min-w-0 overflow-x-auto" bind:clientWidth={boxWidth}>
		{#if boxWidth}
			<svg {width} {height} role="list" aria-label={label} class="block">
				<!-- recessive hairline grid, one step off the surface -->
				{#each ticks as t (t)}
					<line
						x1={M.left}
						x2={width - M.right}
						y1={y(t)}
						y2={y(t)}
						class="stroke-line"
						stroke-width="1"
						aria-hidden="true"
					/>
					<text
						x={M.left - 8}
						y={y(t)}
						dy="0.32em"
						text-anchor="end"
						class="fill-ink-3 text-[11.5px] font-semibold tabular-nums"
						aria-hidden="true">{tick(t)}</text
					>
				{/each}

				{#each groups as g, i (g.key)}
					{@const x0 = M.left + band * i}
					{@const xBars = x0 + (band - (bar * 2 + GAP)) / 2}
					<!-- Focusable on purpose: keyboard focus shows the same tooltip as hover, and the
						label reads both values (dataviz interaction spec) -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<g
						role="listitem"
						tabindex="0"
						aria-label={describe(g)}
						class="outline-none"
						onpointerenter={() => (active = i)}
						onpointerleave={() => (active = null)}
						onfocus={() => (active = i)}
						onblur={() => (active = null)}
					>
						<!-- hit target: the whole column, larger than the bars -->
						<rect
							x={x0}
							y={M.top}
							width={band}
							height={inner.h}
							class={active === i ? 'fill-tint-2' : 'fill-transparent'}
						/>
						{#each SERIES as s, k (s.key)}
							<path d={barPath(xBars + k * (bar + GAP), g[s.key])} class={s.fill} />
						{/each}
						{#each lines(g.label) as line, l (l)}
							<text
								x={x0 + band / 2}
								y={M.top + inner.h + 16 + l * 14}
								text-anchor="middle"
								class={[
									'text-[12px]',
									g.current ? 'fill-ink font-extrabold' : 'fill-ink-3 font-semibold'
								]}
								aria-hidden="true">{line}</text
							>
						{/each}
					</g>
				{/each}
				<line
					x1={M.left}
					x2={width - M.right}
					y1={M.top + inner.h}
					y2={M.top + inner.h}
					class="stroke-line-strong"
					stroke-width="1"
					aria-hidden="true"
				/>
			</svg>

			{#if empty}
				<p
					class="pointer-events-none absolute inset-x-0 top-1/3 text-center text-body font-semibold text-ink-3"
				>
					Belum ada transaksi dibayar di rentang ini.
				</p>
			{/if}

			<!-- One tooltip, both series; values lead, names follow -->
			{#if tip}
				<div
					class="pointer-events-none absolute top-1 z-10 min-w-40 -translate-x-1/2 rounded-control bg-surface px-3 py-2.5 shadow-raised"
					style:left="{tipLeft}px"
					aria-hidden="true"
				>
					<p class="mb-1.5 text-small font-bold text-ink-2">{tip.title}</p>
					{#each SERIES as s (s.key)}
						<p class="flex items-center gap-2 text-small">
							<span class={['inline-block h-0.5 w-3 rounded', s.bg]}></span>
							<b class="text-ink tabular-nums">{s.sign}{rupiah(tip[s.key])}</b>
							<span class="text-ink-3">{s.name}</span>
						</p>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Table view: every value without hovering -->
	<details class="text-small">
		<summary class="w-fit cursor-pointer font-bold text-accent-ink">Lihat tabel</summary>
		<div class="bf-table-wrap mt-2 min-w-0">
			<table class="bf-table">
				<thead>
					<tr>
						<th scope="col">{label}</th>
						<th scope="col" class="num">Pemasukan</th>
						<th scope="col" class="num">Pengeluaran</th>
					</tr>
				</thead>
				<tbody>
					{#each groups as g (g.key)}
						<tr>
							<th scope="row" class={['text-left', g.current ? 'font-extrabold' : 'font-semibold']}
								>{g.title}</th
							>
							<td class="num bf-amount--in">+{rupiah(g.income)}</td>
							<td class="num bf-amount--out">−{rupiah(g.expense)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</div>
