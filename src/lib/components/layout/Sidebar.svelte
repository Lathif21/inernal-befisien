<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import { isActive, navItems, type NavItem } from '#lib/nav.ts';

	type Props = {
		/** Late + due-today steps for the current user (Strategi badge); filled in P1-07c */
		strategyCount?: number;
	};

	let { strategyCount = 0 }: Props = $props();

	const main = navItems.filter((i) => !i.bottom);
	const bottom = navItems.filter((i) => i.bottom);
</script>

{#snippet item(nav: NavItem)}
	{@const active = isActive(nav, page.url.pathname)}
	{@const count = nav.badge === 'strategy' ? strategyCount : 0}
	<a
		href={resolve(nav.href)}
		aria-current={active ? 'page' : undefined}
		title={nav.label}
		class={[
			'shrink-0 md:max-lg:justify-center md:max-lg:px-0',
			nav.phase && !active && 'opacity-70'
		]}
	>
		<nav.icon size={18} strokeWidth={1.75} />
		<span class="md:max-lg:sr-only">{nav.label}</span>
		{#if nav.phase}
			<span
				class="ml-auto rounded-pill bg-navy-2 px-2 py-0.5 text-[10.5px] font-bold text-on-dark-muted md:max-lg:hidden"
				>Fase {nav.phase}</span
			>
		{/if}
		{#if count > 0}
			<span
				class={[
					'bf-badge md:max-lg:absolute md:max-lg:top-1 md:max-lg:right-1',
					active && 'bg-surface! text-danger!'
				]}
				aria-label="{count} langkah terlambat atau jatuh tempo hari ini">{count}</span
			>
		{/if}
	</a>
{/snippet}

<!--
	Desktop (lg+): 240px column. Tablet (md): 72px icon rail. Phone: stacked on top,
	nav items scroll horizontally (docs/design-system/components/SidebarNav).
-->
<nav
	class="bf-nav sticky top-0 z-30 gap-3! px-4! py-3! md:h-dvh md:w-[72px] md:gap-1! md:px-3! md:py-5! lg:w-(--size-sidebar) lg:px-4!"
	aria-label="Menu utama"
>
	<div class="px-2 md:pb-5 md:max-lg:flex md:max-lg:justify-center md:max-lg:px-0">
		<span class="md:max-lg:hidden"><BrandLogo /></span>
		<span class="hidden md:max-lg:inline"><BrandLogo markOnly /></span>
	</div>

	<div
		class="-mx-4 flex [scrollbar-width:none] gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-1 md:flex-col md:overflow-visible md:px-0 md:pb-0 [&>a]:relative"
	>
		{#each main as nav (nav.href)}
			{@render item(nav)}
		{/each}
		<span class="hidden md:block md:flex-1"></span>
		{#each bottom as nav (nav.href)}
			{@render item(nav)}
		{/each}
	</div>
</nav>
