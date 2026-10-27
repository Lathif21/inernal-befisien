<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Send from '@lucide/svelte/icons/send';
	import X from '@lucide/svelte/icons/x';
	import Field from '#lib/components/form/Field.svelte';
	import EmailBody from '#lib/components/inbox/EmailBody.svelte';
	import RichTextEditor from '#lib/components/inbox/RichTextEditor.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import {
		EMAIL_MAX_FILES,
		EMAIL_UPLOAD_LIMIT,
		fileSize,
		isBlockedFile,
		RESEND_RETENTION_DAYS,
		uploadSize
	} from '#lib/email.ts';
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
	let editor = $state<RichTextEditor>();
	let fileInput: HTMLInputElement;
	let files = $state<File[]>([]);
	// The editor's weight (pictures included), refreshed on every change
	let bodyWeight = $state(0);
	const used = $derived(uploadSize('', files) + bodyWeight);

	// The drawer's content (and the editor) is new each time it opens; so is the file list
	$effect(() => {
		if (open) {
			error = null;
			showCc = !!cc;
			files = [];
			bodyWeight = 0;
		}
	});

	const fieldError = (name: string) => (error?.field === name ? [error.text] : undefined);

	function addFiles(list: File[]) {
		const blocked = list.filter((f) => isBlockedFile(f.name));
		if (blocked.length)
			toast.error(
				`${blocked.map((f) => f.name).join(', ')} tidak bisa dikirim: file program ditolak layanan email.`
			);
		const next = [...files, ...list.filter((f) => !isBlockedFile(f.name) && f.size > 0)];
		if (next.length > EMAIL_MAX_FILES)
			toast.error(`Maksimal ${EMAIL_MAX_FILES} lampiran per email.`);
		files = next.slice(0, EMAIL_MAX_FILES);
		if (error?.field === 'files') error = null;
	}

	const bodyLabelId = $derived(`${formId}-body-label`);
</script>

<Drawer bind:open title={threadId ? 'Balas email' : 'Tulis email'} {description}>
	<form
		id={formId}
		method="post"
		action="?/send"
		enctype="multipart/form-data"
		class="flex flex-col gap-4"
		novalidate
		use:enhance={({ formData, cancel }) => {
			error = null;
			const body = editor?.getHTML() ?? '';
			if (!body) {
				error = { text: 'Tulis isi email.', field: 'body' };
				editor?.focus();
				return cancel();
			}
			const size = uploadSize(body, files);
			if (size > EMAIL_UPLOAD_LIMIT) {
				error = {
					text: `Lampiran dan gambar ${fileSize(size)}, maksimal ${fileSize(EMAIL_UPLOAD_LIMIT)} per email. Hapus lampiran atau gambar yang besar.`,
					field: 'files'
				};
				return cancel();
			}
			formData.set('body', body);
			formData.delete('files');
			for (const f of files) formData.append('files', f);
			sending = true;
			return async ({ result }) => {
				sending = false;
				if (result.type === 'success') {
					open = false;
					key = crypto.randomUUID();
					files = [];
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

		{#if error && !['to', 'cc', 'subject', 'body', 'files'].includes(error.field)}
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

		<!-- bf-field markup by hand: the editor is a contenteditable, labelled by id -->
		<div class="bf-field">
			<span id={bodyLabelId}>Pesan<span class="text-danger" aria-hidden="true"> *</span></span>
			<RichTextEditor
				bind:this={editor}
				id="{formId}-body"
				labelledby={bodyLabelId}
				describedby={fieldError('body') ? `${formId}-body-error` : `${formId}-body-hint`}
				invalid={!!fieldError('body')}
				onfiles={addFiles}
				onchange={() => {
					bodyWeight = editor?.weight() ?? 0;
					if (error?.field === 'body') error = null;
				}}
			/>
			{#if fieldError('body')}
				<span id="{formId}-body-error" class="bf-field__error">{error?.text}</span>
			{:else}
				<span id="{formId}-body-hint" class="bf-field__hint">
					Tempel, seret atau sisipkan gambar langsung di dalam pesan.
					{#if threadId}Email sebelumnya dikutip otomatis di bawah pesan Anda.{/if}
				</span>
			{/if}
		</div>

		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<button
					type="button"
					class="bf-btn bf-btn--secondary bf-btn--sm"
					onclick={() => fileInput.click()}
				>
					<Paperclip size={14} strokeWidth={2} />
					Lampirkan file
				</button>
				<span
					class="text-small {used > EMAIL_UPLOAD_LIMIT ? 'font-bold text-danger' : 'text-ink-3'}"
				>
					{fileSize(used)} dari {fileSize(EMAIL_UPLOAD_LIMIT)} (lampiran + gambar)
				</span>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				multiple
				hidden
				onchange={(e) => {
					addFiles([...(e.currentTarget.files ?? [])]);
					e.currentTarget.value = '';
				}}
			/>
			{#if files.length}
				<ul class="flex flex-col gap-1.5" aria-label="Lampiran">
					{#each files as file, i (file)}
						<li class="flex items-center gap-2 rounded-control bg-tint-2 py-1 pr-1 pl-3 text-small">
							<Paperclip size={14} strokeWidth={2} class="shrink-0 text-ink-3" />
							<span class="min-w-0 flex-1 truncate font-bold text-ink">{file.name}</span>
							<span class="shrink-0 text-ink-3">{fileSize(file.size)}</span>
							<button
								type="button"
								class="bf-icon-btn size-8! shrink-0 border-0! bg-transparent!"
								aria-label="Hapus lampiran {file.name}"
								onclick={() => (files = files.filter((_, j) => j !== i))}
							>
								<X size={14} strokeWidth={2} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if fieldError('files')}
				<p role="alert" class="bf-field__error">{error?.text}</p>
			{/if}
			<p class="text-small text-ink-3">
				Lampiran bisa diunduh lagi dari CRM selama {RESEND_RETENTION_DAYS} hari; gambar di dalam pesan
				tetap tersimpan.
			</p>
		</div>

		{#if signature}
			<div class="flex flex-col gap-2">
				<p class="text-small font-bold text-ink-2">Tanda tangan otomatis</p>
				<!-- The same HTML the email carries, in the sandboxed email frame -->
				<EmailBody html={signature} text={null} />
				<p class="text-small text-ink-3">
					Telepon dan kota diambil dari
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
