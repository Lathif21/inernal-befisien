<script lang="ts">
	import type { Component } from 'svelte';
	import { resolve } from '$app/paths';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import Mail from '@lucide/svelte/icons/mail';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Phone from '@lucide/svelte/icons/phone';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import StickyNote from '@lucide/svelte/icons/sticky-note';
	import Users from '@lucide/svelte/icons/users';
	import Wallet from '@lucide/svelte/icons/wallet';
	import { ACTIVITY_TYPE_LABELS, type ActivityType } from '#lib/constants.ts';
	import { dateID, dayKeyWib } from '#lib/format.ts';

	type Entry = {
		id: string;
		type: ActivityType;
		body: string | null;
		occurredAt: Date;
		userName: string | null;
		dealTitle?: string | null;
		projectName?: string | null;
		/** An email entry carries its thread (P3-08) */
		meta?: unknown;
	};

	type Props = {
		entries: Entry[];
		/** Shown when there are no entries */
		empty?: string;
	};

	let { entries, empty = 'Belum ada aktivitas.' }: Props = $props();

	const ICONS: Record<ActivityType, Component<{ size?: number; strokeWidth?: number }>> = {
		note: StickyNote,
		call: Phone,
		meeting: Users,
		whatsapp: MessageCircle,
		email: Mail,
		stage_change: ArrowRightLeft,
		action_done: CircleCheck,
		transaction: Wallet,
		ai_accepted: Sparkles,
		system: Info
	};

	// Manual entries in accent, automatic ones muted, AI in the AI colour only
	const TONE: Partial<Record<ActivityType, string>> = {
		stage_change: 'bg-tint-2 text-ink-2',
		action_done: 'bg-success-bg text-success',
		transaction: 'bg-tint-2 text-ink-2',
		ai_accepted: 'bg-ai-bg text-ai',
		system: 'bg-tint-2 text-ink-3'
	};

	/** The Kotak Masuk thread of an email entry */
	function threadOf(e: Entry) {
		const id = (e.meta as { threadId?: unknown } | null | undefined)?.threadId;
		return e.type === 'email' && typeof id === 'string' ? id : null;
	}

	const thisYear = dayKeyWib().slice(0, 4);
	/** "23 Okt 10:00" this year, "23 Okt 2025 · 10:00" otherwise (WIB) */
	function when(d: Date) {
		return dayKeyWib(d).startsWith(thisYear)
			? dateID(d, 'datetime')
			: `${dateID(d)} · ${dateID(d, 'time')}`;
	}
</script>

{#if entries.length === 0}
	<p class="rounded-control bg-tint-2 px-4 py-6 text-center text-body font-semibold text-ink-2">
		{empty}
	</p>
{:else}
	<ol class="flex flex-col">
		{#each entries as e (e.id)}
			{@const Icon = ICONS[e.type]}
			<li class="flex gap-3 border-t border-tint-2 py-3 first:border-t-0 first:pt-0">
				<span
					class={[
						'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full',
						TONE[e.type] ?? 'bg-tint text-accent-ink'
					]}
					aria-hidden="true"
				>
					<Icon size={15} strokeWidth={1.9} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="flex flex-wrap items-baseline gap-x-2 text-small">
						<span class="font-bold text-ink">{ACTIVITY_TYPE_LABELS[e.type]}</span>
						<time
							class="font-mono text-[12px] font-medium text-ink-3"
							datetime={new Date(e.occurredAt).toISOString()}>{when(new Date(e.occurredAt))}</time
						>
						<span class="text-ink-3">· {e.userName ?? 'Sistem'}</span>
					</p>
					{#if e.body}
						<p class="mt-1 text-body break-words whitespace-pre-line text-ink">{e.body}</p>
					{/if}
					{#if threadOf(e)}
						<a
							href={resolve('/(app)/inbox/[id]', { id: threadOf(e)! })}
							class="mt-1 inline-block text-small font-bold text-accent-ink hover:underline"
							>Buka email</a
						>
					{/if}
					{#if e.dealTitle || e.projectName}
						<p class="mt-1 text-small text-ink-2">
							{e.dealTitle ? `Deal: ${e.dealTitle}` : `Proyek: ${e.projectName}`}
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
{/if}
