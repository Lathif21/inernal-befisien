<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Clock from '@lucide/svelte/icons/clock';
	import Forward from '@lucide/svelte/icons/forward';
	import Link2 from '@lucide/svelte/icons/link-2';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Reply from '@lucide/svelte/icons/reply';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Send from '@lucide/svelte/icons/send';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Avatar from '#lib/components/Avatar.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ComposeDrawer from '#lib/components/inbox/ComposeDrawer.svelte';
	import EmailBody from '#lib/components/inbox/EmailBody.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		addressLabel,
		attachmentExpired,
		fileSize,
		parseAddress,
		RESEND_RETENTION_DAYS
	} from '#lib/email.ts';
	import { sendAtLabel, trashPurgeDate } from '#lib/email-draft.ts';
	import { forwardSubject } from '#lib/email-forward.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { dateID } from '#lib/format.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const thread = $derived(data.thread);
	const subject = $derived(thread.messages[0]?.subject || '(tanpa subjek)');
	let replying = $state(false);
	let linking = $state(false);
	// Teruskan: the message being forwarded (its drawer is open while forwardOpen)
	type Message = (typeof data.thread.messages)[number];
	let forwarding = $state<Message | null>(null);
	let forwardOpen = $state(false);

	function startForward(m: Message) {
		forwarding = m;
		forwardOpen = true;
	}

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

	const replyTo = $derived(data.reply.to ? label(data.reply.to.split(',')[0]) : '');

	// P3-09: Balas carries on the writer's saved reply; scheduled ones are listed under the thread
	const replyDraft = $derived(data.drafts.find((d) => d.status === 'draft') ?? null);
	const waiting = $derived(data.drafts.filter((d) => d.status !== 'draft'));
	let purging = $state(false);

	/** Thread actions that leave the page: back to the list, then the toast */
	const leaveTo =
		(filter?: 'trash'): SubmitFunction =>
		() =>
		async ({ result }) => {
			if (result.type === 'success') {
				await goto(filter ? resolve(`inbox?filter=${filter}`) : resolve('inbox'));
				toast.success(String(result.data?.done));
			} else if (result.type === 'failure') toast.error(String(result.data?.error));
		};
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
		{#if !thread.deletedAt}
			<form method="post" action="?/trash" use:enhance={leaveTo()}>
				<input type="hidden" name="threadId" value={thread.threadId} />
				<button type="submit" class="bf-btn bf-btn--ghost bf-btn--sm">
					<Trash2 size={16} strokeWidth={2} />
					Hapus
				</button>
			</form>
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

	{#if thread.deletedAt}
		<div
			class="flex flex-wrap items-center gap-3 rounded-card bg-danger-bg px-5 py-4 text-body text-ink"
			role="status"
		>
			<p class="min-w-0 flex-1 font-semibold">
				Percakapan ini ada di Sampah dan dihapus permanen pada {dateID(
					trashPurgeDate(thread.deletedAt),
					'long'
				)}.
			</p>
			<form method="post" action="?/restore" use:enhance={refreshThenToast()}>
				<input type="hidden" name="threadId" value={thread.threadId} />
				<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm">
					<RotateCcw size={16} strokeWidth={2} />
					Pulihkan
				</button>
			</form>
			<button
				type="button"
				class="bf-btn bf-btn--sm bg-danger-fill text-on-accent"
				onclick={() => (purging = true)}
			>
				Hapus permanen
			</button>
		</div>
	{/if}

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
					<div class="flex shrink-0 flex-col items-end gap-1">
						<time
							class="font-mono text-[12px] font-medium text-ink-3"
							datetime={new Date(m.sentAt).toISOString()}
							>{dateID(m.sentAt)} · {dateID(m.sentAt, 'time')}</time
						>
						<button
							type="button"
							class="bf-btn bf-btn--ghost bf-btn--sm"
							aria-label="Teruskan email dari {sender}, {dateID(m.sentAt)}"
							onclick={() => startForward(m)}
						>
							<Forward size={15} strokeWidth={2} />
							Teruskan
						</button>
					</div>
				</div>

				<EmailBody html={m.html} text={m.text} />

				{#if m.attachments.length}
					<ul class="flex flex-wrap gap-2" aria-label="Lampiran">
						{#each m.attachments as a (a.id)}
							<li>
								{#if attachmentExpired(m.sentAt)}
									<!-- Resend no longer has the file -->
									<button
										type="button"
										class="bf-btn bf-btn--secondary bf-btn--sm max-w-72"
										disabled
										title="Resend menyimpan lampiran {RESEND_RETENTION_DAYS} hari"
									>
										<Paperclip size={14} strokeWidth={2} />
										<span class="truncate">{a.filename}</span>
										<span class="shrink-0">kedaluwarsa</span>
									</button>
								{:else}
									<form method="post" action="?/attachment" target="_blank">
										<input type="hidden" name="emailId" value={m.id} />
										<input type="hidden" name="attachmentId" value={a.id} />
										<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm max-w-72">
											<Paperclip size={14} strokeWidth={2} />
											<span class="truncate">{a.filename}</span>
											<span class="shrink-0 text-ink-3">{fileSize(a.size)}</span>
										</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>

	{#if waiting.length}
		<ul class="flex flex-col gap-3" aria-label="Balasan terjadwal">
			{#each waiting as d (d.id)}
				<li class="flex flex-wrap items-center gap-3 rounded-card bg-surface p-4">
					<Clock size={18} strokeWidth={2} class="shrink-0 text-accent-ink" aria-hidden="true" />
					<div class="min-w-0 flex-1">
						<p class="font-bold text-ink">
							{#if d.status === 'failed'}
								Balasan gagal dikirim
							{:else if d.status === 'sending'}
								Balasan sedang dikirim
							{:else}
								Balasan terjadwal {d.scheduledAt ? sendAtLabel(d.scheduledAt) : ''} WIB
							{/if}
						</p>
						{#if d.status === 'failed' && d.error}
							<p class="text-small font-semibold text-danger">{d.error}</p>
						{:else}
							<p class="truncate text-small text-ink-3">Kepada: {d.to}</p>
						{/if}
					</div>
					{#if d.status !== 'sending'}
						<form
							method="post"
							action="?/unschedule"
							use:enhance={() =>
								async ({ result }) => {
									if (result.type === 'success') {
										await invalidateAll();
										replying = true;
									} else if (result.type === 'failure') toast.error(String(result.data?.error));
								}}
						>
							<input type="hidden" name="draftId" value={d.id} />
							<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm">Ubah</button>
						</form>
						{#if d.status === 'scheduled'}
							<form method="post" action="?/unschedule" use:enhance={refreshThenToast()}>
								<input type="hidden" name="draftId" value={d.id} />
								<button type="submit" class="bf-btn bf-btn--ghost bf-btn--sm"
									>Batalkan jadwal</button
								>
							</form>
						{/if}
						<form method="post" action="?/sendNow" use:enhance={refreshThenToast()}>
							<input type="hidden" name="draftId" value={d.id} />
							<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm">
								<Send size={14} strokeWidth={2} />
								Kirim sekarang
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex flex-wrap items-center justify-end gap-3">
		{#if replyDraft}
			<p class="text-small text-ink-3">
				Draf balasan tersimpan {dateID(replyDraft.updatedAt, 'datetime')}
			</p>
		{/if}
		<button type="button" class="bf-btn bf-btn--primary" onclick={() => (replying = true)}>
			<Reply size={18} strokeWidth={2} />
			{replyDraft ? 'Lanjutkan balasan' : 'Balas'}
		</button>
	</div>
</main>

<Modal bind:open={purging} title="Hapus permanen?">
	<p class="text-body text-ink-2">
		Percakapan <b>{subject}</b> dihapus permanen dan tidak bisa dipulihkan. Timeline klien tetap mencatatnya.
	</p>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (purging = false)}
			>Batal</button
		>
		<form method="post" action="?/deleteForever" use:enhance={leaveTo('trash')}>
			<input type="hidden" name="threadId" value={thread.threadId} />
			<button type="submit" class="bf-btn bg-danger-fill text-on-accent">Hapus permanen</button>
		</form>
	{/snippet}
</Modal>

<ComposeDrawer
	bind:open={replying}
	threadId={thread.threadId}
	to={replyDraft?.to ?? data.reply.to}
	cc={replyDraft?.cc ?? data.reply.cc}
	subject={replyDraft?.subject || data.reply.subject}
	description={replyTo ? `Membalas ${replyTo}` : undefined}
	signature={data.signature}
	draft={replyDraft}
	canSchedule={data.canSchedule}
	onsent={() => invalidateAll()}
	onscheduled={() => invalidateAll()}
	onchanged={() => invalidateAll()}
/>

{#if forwarding}
	<ComposeDrawer
		bind:open={forwardOpen}
		subject={forwardSubject(forwarding.subject)}
		description="Meneruskan email dari {addressLabel({
			name: forwarding.fromName,
			email: forwarding.fromEmail
		})}"
		signature={data.signature}
		canSchedule={data.canSchedule}
		onscheduled={() => goto(resolve('inbox?filter=scheduled'))}
		onchanged={() => invalidateAll()}
		forward={{
			emailId: forwarding.id,
			attachments: forwarding.attachments.filter((a) => !a.inline),
			expired: attachmentExpired(forwarding.sentAt)
		}}
		onsent={() => invalidateAll()}
	/>
{/if}
