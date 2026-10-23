<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { Popover } from 'bits-ui';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { dayKeyWib } from '#lib/format.ts';
	import {
		addDays,
		PERIOD_LABELS,
		periodParams,
		type Period,
		type ResolvedPeriod
	} from '#lib/period.ts';

	type Props = {
		/** From resolvePeriod() in the page load */
		value: ResolvedPeriod;
		/**
		 * Page URL with these params changed (undefined removes one). The page keeps its other
		 * filters and builds the link with resolve().
		 */
		href: (params: Record<string, string | undefined>) => ResolvedPathname;
	};

	let { value, href }: Props = $props();

	const today = $derived(dayKeyWib());
	/** Switching Harian / Mingguan / … keeps today when it is in view, otherwise the period start */
	const anchor = $derived(value.from <= today && today <= value.to ? today : value.from);
	const link = (period: Period, from: string, to?: string) =>
		href({ to: undefined, ...periodParams(period, from, to) });
	/** Prev / next: one period; a custom range moves by its own length */
	const shifted = (start: string) =>
		value.period === 'custom'
			? link('custom', start, addDays(start, value.days - 1))
			: link(value.period, start);

	let customOpen = $state(false);
	let customFrom = $state('');
	let customTo = $state('');
	$effect(() => {
		if (customOpen) {
			customFrom = value.from;
			customTo = value.to;
		}
	});

	function applyCustom(e: SubmitEvent) {
		e.preventDefault();
		if (!customFrom) return;
		customOpen = false;
		goto(link('custom', customFrom, customTo || customFrom), { reset: false });
	}

	const OPTIONS: Exclude<Period, 'custom'>[] = ['day', 'week', 'month', 'year'];
</script>

<!-- The one period filter: Harian · Mingguan · Bulanan · Tahunan · Custom + prev / next + label
	(docs/design-system/components/PeriodFilter). Links, so a refresh or a shared URL keeps it. -->
<div class="flex flex-wrap items-center gap-2">
	<div class="bf-seg" role="group" aria-label="Rentang waktu">
		{#each OPTIONS as p (p)}
			<a
				href={link(p, anchor)}
				aria-current={value.period === p ? 'page' : undefined}
				data-sveltekit-noscroll
				data-sveltekit-keepfocus>{PERIOD_LABELS[p]}</a
			>
		{/each}
		<Popover.Root bind:open={customOpen}>
			<Popover.Trigger
				class={[
					'min-h-8.5 rounded-[9px] px-3 text-[13px] font-bold',
					value.period === 'custom' ? 'bg-accent text-on-accent' : 'text-ink-2 hover:text-ink'
				]}
				aria-pressed={value.period === 'custom'}
			>
				Custom
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					role="dialog"
					aria-label="Rentang tanggal custom"
					sideOffset={8}
					align="end"
					class="z-50 w-[min(320px,calc(100vw-32px))] rounded-kanban border border-line bg-surface p-4 shadow-raised"
				>
					<form class="flex flex-col gap-3" onsubmit={applyCustom}>
						<p class="text-small font-bold text-ink-2">Rentang tanggal (WIB)</p>
						<div class="grid grid-cols-2 gap-3">
							<label class="bf-field">
								Dari
								<input type="date" bind:value={customFrom} required max={customTo || undefined} />
							</label>
							<label class="bf-field">
								Sampai
								<input type="date" bind:value={customTo} min={customFrom || undefined} />
							</label>
						</div>
						<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm">Terapkan</button>
					</form>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	</div>

	<div class="bf-period">
		<a
			class="bf-icon-btn"
			href={shifted(value.prevAnchor)}
			aria-label="Periode sebelumnya"
			data-sveltekit-noscroll
			data-sveltekit-keepfocus
		>
			<ChevronLeft size={15} strokeWidth={2.4} />
		</a>
		<span class="bf-period__label" aria-live="polite">{value.label}</span>
		{#if value.nextInFuture}
			<span
				class="bf-icon-btn opacity-60"
				role="link"
				aria-disabled="true"
				aria-label="Periode berikutnya"
			>
				<ChevronRight size={15} strokeWidth={2.4} class="text-ink-disabled" />
			</span>
		{:else}
			<a
				class="bf-icon-btn"
				href={shifted(value.nextAnchor)}
				aria-label="Periode berikutnya"
				data-sveltekit-noscroll
				data-sveltekit-keepfocus
			>
				<ChevronRight size={15} strokeWidth={2.4} />
			</a>
		{/if}
	</div>
</div>
