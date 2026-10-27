<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Send from '@lucide/svelte/icons/send';
	import Field from '#lib/components/form/Field.svelte';
	import EmailBody from '#lib/components/inbox/EmailBody.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import { toast } from '#lib/toast.ts';

	type Props = {
		open: boolean;
		/** Reply in this thread; empty = a new email */
		threadId?: string;
		to?: string;
		cc?: string;
		subject?: string;
		/** Shown above the form, e.g. "Membalas Budi Santoso" */
		description?: string;
		/** The signature card added under the message (signatureHtml), shown as a preview */
		signature?: string;
		/** After Resend accepted it; the page reloads or opens the thread */
		onsent: (threadId: string) => Promise<void> | void;
	};

	let {
		open = $bindable(),
		threadId = '',
		to = '',
		cc = '',
		subject = '',
		description,
		signature = '',
		onsent
	}: Props = $props();

	const formId = $derived(`email-form-${threadId || 'new'}`);
	// One key per email written, so a double click or a retry after a timeout sends once
	let key = $state(crypto.randomUUID());
	let sending = $state(false);
	let error = $state<{ text: string; field: string } | null>(null);
	let showCc = $state(false);

	$effect(() => {
		if (open) {
			error = null;
			showCc = !!cc;
		}
	});

	const fieldError = (name: string) => (error?.field === name ? [error.text] : undefined);
</script>

<Drawer bind:open title={threadId ? 'Balas email' : 'Tulis email'} {description}>
	<form
		id={formId}
		method="post"
		action="?/send"
		class="flex flex-col gap-4"
		novalidate
		use:enhance={() => {
			sending = true;
			error = null;
			return async ({ result }) => {
				sending = false;
				if (result.type === 'success') {
					open = false;
					key = crypto.randomUUID();
					await onsent(String(result.data?.threadId ?? threadId));
					toast.success(String(result.data?.done ?? 'Email terkirim.'));
				} else if (result.type === 'failure') {
					error = {
						text: String(result.data?.error ?? 'Email gagal dikirim.'),
						field: String(result.data?.field ?? '')
					};
				} else if (result.type === 'error') {
					error = { text: 'Email gagal dikirim. Coba lagi sebentar lagi.', field: '' };
				}
			};
		}}
	>
		<input type="hidden" name="threadId" value={threadId} />
		<input type="hidden" name="key" value={key} />

		{#if error && !['to', 'cc', 'subject', 'body'].includes(error.field)}
			<p
				role="alert"
				class="rounded-control bg-danger-bg px-3.5 py-2.5 text-small font-bold text-danger"
			>
				{error.text}
			</p>
		{/if}

		<Field
			label="Kepada"
			name="to"
			required
			errors={fieldError('to')}
			hint="Pisahkan beberapa alamat dengan koma"
		>
			{#snippet children(attrs)}
				<input {...attrs} type="text" defaultValue={to} autocomplete="email" maxlength="2000" />
			{/snippet}
		</Field>

		{#if showCc}
			<Field label="Cc" name="cc" errors={fieldError('cc')}>
				{#snippet children(attrs)}
					<input {...attrs} type="text" defaultValue={cc} maxlength="2000" />
				{/snippet}
			</Field>
		{:else}
			<button
				type="button"
				class="self-start text-small font-bold text-accent-ink hover:underline"
				onclick={() => (showCc = true)}>+ Tambah Cc</button
			>
		{/if}

		<Field label="Subjek" name="subject" required={!threadId} errors={fieldError('subject')}>
			{#snippet children(attrs)}
				<input {...attrs} type="text" defaultValue={subject} maxlength="250" />
			{/snippet}
		</Field>

		<Field
			label="Pesan"
			name="body"
			required
			errors={fieldError('body')}
			hint={threadId ? 'Email sebelumnya dikutip otomatis di bawah pesan Anda' : undefined}
		>
			{#snippet children(attrs)}
				<textarea {...attrs} rows="12" maxlength="50000"></textarea>
			{/snippet}
		</Field>

		{#if signature}
			<div class="flex flex-col gap-2">
				<p class="text-small font-bold text-ink-2">Tanda tangan otomatis</p>
				<!-- The same HTML the email carries, in the sandboxed email frame -->
				<EmailBody html={signature} text={null} />
				<p class="text-small text-ink-3">
					Nama perusahaan, telepon dan kota diambil dari
					<a href={resolve('settings/company')} class="font-bold text-accent-ink hover:underline"
						>Pengaturan → Profil perusahaan</a
					>.
				</p>
			</div>
		{/if}
	</form>

	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (open = false)}
			>Batal</button
		>
		<button type="submit" form={formId} class="bf-btn bf-btn--primary" disabled={sending}>
			<Send size={16} strokeWidth={2} />
			{sending ? 'Mengirim…' : 'Kirim'}
		</button>
	{/snippet}
</Drawer>
