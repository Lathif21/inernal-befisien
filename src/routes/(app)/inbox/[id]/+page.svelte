<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Link2 from '@lucide/svelte/icons/link-2';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Reply from '@lucide/svelte/icons/reply';
	import Avatar from '#lib/components/Avatar.svelte';
	import ComposeDrawer from '#lib/components/inbox/ComposeDrawer.svelte';
	import EmailBody from '#lib/components/inbox/EmailBody.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { addressLabel, parseAddress } from '#lib/email.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { dateID } from '#lib/format.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const thread = $derived(data.thread);
	const subject = $derived(thread.messages[0]?.subject || '(tanpa subjek)');
	let replying = $state(false);
	let linking = $state(false);

	// The load marked the thread read; the sidebar badge was counted before that. Once per thread:
	// the refreshed layout data would otherwise run this effect again, and again.
	let refreshedFor = '';
	$effect(() => {
		if (data.wasUnread && refreshedFor !== data.thread.threadId) {
			refreshedFor = data.thread.threadId;
			invalidate('app:inbox');
		}
	});

	const label = (raw: string) => {
		const a = parseAddress(raw);
		return a ? addressLabel(a) : raw;
	};

	function size(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
	}

	const replyTo = $derived(data.reply.to ? label(data.reply.to.split(',')[0]) : '');
</script>

<Topbar title={subject}>
	{#snippet actions()}
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => (replying = true)}>
			<Reply size={18} strokeWidth={2} />
			Balas
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	<div class="flex flex-wrap items-center gap-3">
		<a href={resolve('inbox')} class="bf-btn bf-btn--ghost bf-btn--sm">
			<ArrowLeft size={16} strokeWidth={2} />
			Email
		</a>
		<span class="flex-1"></span>
		{#if thread.client}
			<a
				href={resolve('/(app)/clients/[id]', { id: thread.client.id })}
				class="bf-chip bf-chip--accent px-3! py-1.5!">Klien: {thread.client.name}</a
			>
		{:else}
			<button
				type="button"
				class="bf-btn bf-btn--secondary bf-btn--sm"
				onclick={() => (linking = !linking)}
				aria-expanded={linking}
			>
				<Link2 size={16} strokeWidth={2} />
				Hubungkan ke klien
			</button>
		{/if}
		{#if thread.messages.some((m) => m.direction === 'in')}
			<form
				method="post"
				action="?/unread"
				use:enhance={() =>
					async ({ result }) => {
						if (result.type === 'success') {
							await goto(resolve('inbox'));
							toast.success(String(result.data?.done));
						} else if (result.type === 'failure') toast.error(String(result.data?.error));
					}}
			>
				<button type="submit" class="bf-btn bf-btn--ghost bf-btn--sm">
					<MailOpen size={16} strokeWidth={2} />
					Tandai belum dibaca
				</button>
			</form>
		{/if}
	</div>

	{#if linking && !thread.client}
		<form
			method="post"
			action="?/link"
			class="flex flex-col gap-3 rounded-card bg-surface p-5"
			use:enhance={refreshThenToast({ end: (ok) => ok && (linking = false) })}
		>
			<p class="text-body font-semibold text-ink-2">
				Email ini belum terhubung ke klien. Pilih kliennya agar email masuk ke timeline klien dan
				dibaca Saran AI.
			</p>
			<div class="bf-field">
				<label for="link-client">Klien</label>
				<select id="link-client" name="clientId" required>
					<option value="">Pilih klien</option>
					{#each data.clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</div>
			<label class="flex items-center gap-2 text-body text-ink">
				<input type="checkbox" name="addContact" checked />
				Simpan pengirim sebagai kontak klien, agar email berikutnya otomatis terhubung
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (linking = false)}
					>Batal</button
				>
				<button type="submit" class="bf-btn bf-btn--primary">Hubungkan</button>
			</div>
		</form>
	{/if}

	<ol class="flex min-w-0 flex-col gap-4">
		{#each thread.messages as m (m.id)}
			{@const sender =
				m.direction === 'out'
					? (m.userName ?? addressLabel({ name: m.fromName, email: m.fromEmail }))
					: addressLabel({ name: m.fromName, email: m.fromEmail })}
			<li class="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5">
				<div class="flex min-w-0 items-start gap-3">
					<Avatar name={sender} size={36} tone={m.direction === 'out' ? 'dark' : 'accent'} />
					<div class="min-w-0 flex-1">
						<p class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-bold text-ink">{sender}</span>
							<span class="min-w-0 truncate text-small text-ink-3">
								{m.direction === 'out' ? `via ${m.fromEmail}` : m.fromEmail}
							</span>
						</p>
						<p class="truncate text-small text-ink-2">
							Kepada: {m.to.map(label).join(', ') || '–'}
							{#if m.cc.length}· Cc: {m.cc.map(label).join(', ')}{/if}
						</p>
					</div>
					<time
						class="shrink-0 font-mono text-[12px] font-medium text-ink-3"
						datetime={new Date(m.sentAt).toISOString()}
						>{dateID(m.sentAt)} · {dateID(m.sentAt, 'time')}</time
					>
				</div>

				<EmailBody html={m.html} text={m.text} />

				{#if m.attachments.length}
					<ul class="flex flex-wrap gap-2" aria-label="Lampiran">
						{#each m.attachments as a (a.id)}
							<li>
								<form method="post" action="?/attachment" target="_blank">
									<input type="hidden" name="emailId" value={m.id} />
									<input type="hidden" name="attachmentId" value={a.id} />
									<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm max-w-72">
										<Paperclip size={14} strokeWidth={2} />
										<span class="truncate">{a.filename}</span>
										<span class="shrink-0 text-ink-3">{size(a.size)}</span>
									</button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>

	<div class="flex justify-end">
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => (replying = true)}>
			<Reply size={18} strokeWidth={2} />
			Balas
		</button>
	</div>
</main>

<ComposeDrawer
	bind:open={replying}
	threadId={thread.threadId}
	to={data.reply.to}
	cc={data.reply.cc}
	subject={data.reply.subject}
	description={replyTo ? `Membalas ${replyTo}` : undefined}
	signature={data.signature}
	onsent={() => invalidateAll()}
/>
