<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { MediaQuery } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import LogOut from '@lucide/svelte/icons/log-out';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '#lib/components/Avatar.svelte';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import { navMenu } from '#lib/components/layout/nav-menu.svelte.ts';
	import { isActive, navItems, type NavItem } from '#lib/nav.ts';
	import { saveSidebarMode, type SidebarMode } from '#lib/sidebar.ts';

	type Props = {
		/** Late + due-today steps for the current user (Strategi badge); filled in P1-07c */
		strategyCount?: number;
		/** Threads with an unread incoming email (P3-08) */
		inboxCount?: number;
		mode: SidebarMode;
		onmodechange: (mode: SidebarMode) => void;
	};

	let { strategyCount = 0, inboxCount = 0, mode, onmodechange }: Props = $props();

	const user = $derived(page.data.user as { name: string; email: string } | undefined);
	const main = navItems.filter((i) => !i.bottom);
	const bottom = navItems.filter((i) => i.bottom);

	const tablet = new MediaQuery('min-width: 48rem');
	const desktop = new MediaQuery('min-width: 64rem');

	// The phone drawer has no use once the sidebar is on screen
	$effect(() => {
		if (tablet.current) navMenu.open = false;
	});

	const rail = $derived(mode === 'collapsed' || (mode === 'auto' && !desktop.current));

	function toggle() {
		const next = rail ? 'expanded' : 'collapsed';
		saveSidebarMode(next);
		onmodechange(next);
	}
</script>

<!-- `rail:` classes only match in the sidebar column; the phone drawer is portalled outside it -->
{#snippet item(nav: NavItem)}
	{@const active = isActive(nav, page.url.pathname)}
	{@const count = nav.badge === 'strategy' ? strategyCount : nav.badge === 'inbox' ? inboxCount : 0}
	<a
		href={resolve(nav.href)}
		aria-current={active ? 'page' : undefined}
		title={nav.label}
		class={[
			'relative shrink-0 rail:justify-center rail:px-0',
			nav.phase && !active && 'opacity-70'
		]}
		onclick={() => (navMenu.open = false)}
	>
		<nav.icon size={18} strokeWidth={1.75} />
		<span class="rail:sr-only">{nav.label}</span>
		{#if nav.phase}
			<span
				class="ml-auto rounded-pill bg-navy-2 px-2 py-0.5 text-[10.5px] font-bold text-on-dark-muted rail:hidden"
				>Fase {nav.phase}</span
			>
		{/if}
		{#if count > 0}
			<span
				class={[
					'bf-badge rail:absolute rail:top-1 rail:right-1',
					active && 'bg-surface! text-danger!'
				]}
				aria-label={nav.badge === 'inbox'
					? `${count} percakapan email belum dibaca`
					: `${count} langkah terlambat atau jatuh tempo hari ini`}>{count}</span
			>
		{/if}
	</a>
{/snippet}

{#snippet items()}
	{#each main as nav (nav.href)}
		{@render item(nav)}
	{/each}
	<span class="flex-1"></span>
	{#each bottom as nav (nav.href)}
		{@render item(nav)}
	{/each}
{/snippet}

<!--
	Tablet and desktop: 240px column or 72px icon rail (docs/design-system/components/SidebarNav).
	The toggle at the bottom picks one and remembers it in a cookie; until then tablets get the
	rail and desktops the full column. Phones: a drawer opened from the Topbar menu button.
-->
<nav
	class="bf-nav sticky top-0 z-30 hidden h-dvh w-(--size-sidebar) shrink-0 md:flex rail:w-18 rail:px-3"
	aria-label="Menu utama"
>
	<div class="px-2 pb-5 rail:flex rail:justify-center rail:px-0">
		<span class="rail:hidden"><BrandLogo /></span>
		<span class="hidden rail:inline"><BrandLogo markOnly /></span>
	</div>

	<div class="flex flex-1 flex-col gap-1">
		{@render items()}
		<button
			type="button"
			class="bf-nav__toggle mt-1 rail:justify-center rail:px-0"
			title={rail ? 'Perluas menu' : 'Ciutkan menu'}
			onclick={toggle}
		>
			<PanelLeftClose size={18} strokeWidth={1.75} class="rail:hidden" />
			<PanelLeftOpen size={18} strokeWidth={1.75} class="hidden rail:block" />
			<span class="rail:hidden">Ciutkan menu</span>
			<span class="sr-only hidden rail:inline">Perluas menu</span>
		</button>
	</div>
</nav>

<Dialog.Root bind:open={navMenu.open}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-navy/40 md:hidden" />
		<Dialog.Content
			class="bf-nav fixed inset-y-0 left-0 z-50 w-[min(280px,calc(100vw-48px))] overflow-y-auto rounded-r-panel shadow-modal md:hidden"
		>
			<div class="flex items-center justify-between gap-3 pb-5 pl-2">
				<BrandLogo />
				<Dialog.Close
					type="button"
					class="flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill text-on-dark-link hover:bg-navy-2"
					aria-label="Tutup menu"
				>
					<X size={20} strokeWidth={1.75} />
				</Dialog.Close>
			</div>
			<Dialog.Title class="sr-only">Menu utama</Dialog.Title>
			<nav class="flex flex-1 flex-col gap-1" aria-label="Menu utama">
				{@render items()}
			</nav>
			{#if user}
				<div class="mt-3 flex items-center gap-3 border-t border-navy-2 px-2 pt-4">
					<Avatar name={user.name} size={32} />
					<div class="min-w-0 flex-1">
						<p class="truncate text-small font-bold">{user.name}</p>
						<p class="truncate text-small font-semibold text-on-dark-muted">{user.email}</p>
					</div>
					<form method="post" action="/logout">
						<button
							type="submit"
							class="flex size-(--size-touch) items-center justify-center rounded-pill text-on-dark-link hover:bg-navy-2"
							aria-label="Keluar"
							title="Keluar"
						>
							<LogOut size={18} strokeWidth={1.75} />
						</button>
					</form>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
