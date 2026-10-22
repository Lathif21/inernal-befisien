<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { DropdownMenu } from 'bits-ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Avatar from '#lib/components/Avatar.svelte';

	type Props = {
		title: string;
		/** Period filter and similar controls next to the title */
		filters?: Snippet;
		/** Page actions (one primary at most) */
		actions?: Snippet;
	};

	let { title, filters, actions }: Props = $props();

	const user = $derived(page.data.user as { name: string; email: string } | undefined);
	let logoutForm: HTMLFormElement | undefined = $state();
</script>

<svelte:head>
	<title>{title} · Befisien CRM</title>
</svelte:head>

<header
	class="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-3 sm:px-6 md:top-0 lg:px-7"
>
	<h1
		class="min-w-0 flex-1 text-[22px] leading-[1.15] font-extrabold tracking-[-0.02em] sm:text-page-title"
	>
		{title}
	</h1>

	{#if filters}<div class="order-last w-full sm:order-none sm:w-auto">{@render filters()}</div>{/if}
	{#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}

	{#if user}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="flex min-h-(--size-touch) items-center gap-2 rounded-pill py-1 pr-2 pl-1 hover:bg-tint-2"
				aria-label="Menu akun {user.name}"
			>
				<Avatar name={user.name} size={32} />
				<span class="hidden max-w-40 truncate text-small font-semibold sm:inline">{user.name}</span>
				<ChevronDown size={16} strokeWidth={2} class="text-ink-2" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={6}
					class="z-50 min-w-56 rounded-kanban border border-line bg-surface p-1.5 shadow-raised"
				>
					<div class="px-3 py-2">
						<p class="text-small font-bold">{user.name}</p>
						<p class="text-small font-semibold text-ink-3">{user.email}</p>
					</div>
					<DropdownMenu.Separator class="my-1 h-px bg-line" />
					<DropdownMenu.Item
						class="flex min-h-(--size-touch) cursor-pointer items-center gap-2 rounded-control px-3 text-body font-semibold data-highlighted:bg-tint-2"
						onSelect={() => logoutForm?.requestSubmit()}
					>
						<LogOut size={16} strokeWidth={1.75} />
						Keluar
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
		<form method="post" action="/logout" bind:this={logoutForm} hidden></form>
	{/if}
</header>
