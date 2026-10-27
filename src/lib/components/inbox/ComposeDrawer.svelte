<script lang="ts">
	import { untrack } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Clock from '@lucide/svelte/icons/clock';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Send from '@lucide/svelte/icons/send';
	import Trash2 from '@lucide/svelte/icons/trash-2';
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
	import { scheduleChoices, scheduleDefault } from '#lib/email-draft.ts';
	import {
		EMAIL_ATTACH_BUDGET,
		EMAIL_FILE_LINK_DAYS,
		EMAIL_FILE_MAX,
		planFiles
	} from '#lib/email-files.ts';
	import { dateID, dayKeyWib } from '#lib/format.ts';
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
		/**
		 * Teruskan: this stored email goes under the message (which may stay empty), with the ticked
		 * ones of its attachments. Sent as a new conversation, so `threadId` is not used.
		 */
		forward?: {
			emailId: string;
			attachments: { id: string; filename: string; size: number }[];
			/** Resend no longer has the files (RESEND_RETENTION_DAYS) */
			expired: boolean;
		} | null;
		/** After Resend accepted it; the page reloads or opens the thread */
		onsent: (threadId: string) => Promise<void> | void;
		/**
		 * A saved draft to carry on writing (P3-09). Its `to`, `cc`, `subject` and `threadId` come
		 * through the props above.
		 */
		draft?: {
			id: string;
			body: string;
			updatedAt: Date | string;
			scheduledAt: Date | string | null;
			forwardFiles: string[];
			uploads: { fileId: string; filename: string; size: number }[];
		} | null;
		/** Jadwalkan is offered (Trigger.dev is set up) */
		canSchedule?: boolean;
		/** After it was scheduled; the page reloads */
		onscheduled?: () => Promise<void> | void;
		/** The drawer closed after a draft was saved or thrown away: lists and counts refresh */
		onchanged?: () => void;
	};

	let {
		open = $bindable(),
		threadId = '',
		to = '',
		cc = '',
		subject = '',
		description,
		signature = '',
		forward = null,
		onsent,
		draft = null,
		canSchedule = false,
		onscheduled,
		onchanged
	}: Props = $props();

	const formId = $derived(forward ? 'email-form-forward' : `email-form-${threadId || 'new'}`);
	const title = $derived(forward ? 'Teruskan email' : threadId ? 'Balas email' : 'Tulis email');
	// One key per email written, so a double click or a retry after a timeout sends once
	let key = $state(crypto.randomUUID());
	let sending = $state(false);
	let error = $state<{ text: string; field: string } | null>(null);
	let showCc = $state(false);
	let editor = $state<RichTextEditor>();
	let fileInput: HTMLInputElement;
	let formEl = $state<HTMLFormElement>();

	// Drafts (P3-09): saved a moment after each change and when the drawer closes. The id is made
	// here, so every save of this email updates one row.
	let draftId = $state<string>(crypto.randomUUID());
	/** The draft exists on the server */
	let saved = $state(false);
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let savedAt = $state<Date | null>(null);
	/** Something changed since the last save */
	let dirty = false;
	/** Sent, scheduled or thrown away: nothing is saved any more */
	let finished = false;
	/** A draft was saved while open: the page refreshes its lists when the drawer closes */
	let changed = false;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> = Promise.resolve();
	const SAVE_DELAY_MS = 2500;

	// Jadwalkan
	let scheduling = $state(false);
	let sendDate = $state('');
	let sendTime = $state('');
	let schedulePanel = $state<HTMLElement>();
	const choices = $derived(open ? scheduleChoices() : []);

	/**
	 * A file attached in the drawer. It uploads at once, straight to the bucket (presigned PUT from
	 * `?/upload`), so the email itself only carries the email_file ids.
	 */
	type Upload = {
		key: string;
		name: string;
		size: number;
		/** null for a file of a saved draft (already in the bucket) */
		file: File | null;
		fileId: string | null;
		/** 0..1 */
		progress: number;
		state: 'uploading' | 'done' | 'error';
		message?: string;
	};
	let uploads = $state<Upload[]>([]);
	// Running uploads, by Upload.key, so Hapus can stop them (a plain object: never shown)
	const running: Record<string, XMLHttpRequest> = {};
	// The editor's weight (pictures included), refreshed on every change
	let bodyWeight = $state(0);

	// What the server will do: attach while the files fit next to pictures and forwarded files
	const forwardWeight = $derived(
		forward && !forward.expired ? forward.attachments.reduce((s, a) => s + a.size, 0) : 0
	);
	const plan = $derived(
		planFiles(
			uploads.map((u) => ({ key: u.key, size: u.size })),
			Math.max(0, EMAIL_ATTACH_BUDGET - bodyWeight - forwardWeight)
		)
	);
	const asLink = $derived(new Set(plan.link.map((p) => p.key)));
	const busy = $derived(uploads.some((u) => u.state === 'uploading'));

	// The drawer's content (and the editor) is new each time it opens; so is the file list. Only
	// `open` is tracked: refreshed page data must not reset an email being written.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			error = null;
			showCc = !!cc;
			bodyWeight = 0;
			uploads = (draft?.uploads ?? []).map((u) => ({
				key: crypto.randomUUID(),
				name: u.filename,
				size: u.size,
				file: null,
				fileId: u.fileId,
				progress: 1,
				state: 'done' as const
			}));
			draftId = draft?.id ?? crypto.randomUUID();
			saved = !!draft;
			saveState = draft ? 'saved' : 'idle';
			savedAt = draft ? new Date(draft.updatedAt) : null;
			dirty = false;
			finished = false;
			changed = false;
			scheduling = false;
			({ date: sendDate, time: sendTime } = scheduleDefault(draft?.scheduledAt));
		});
	});

	// Closing the drawer stops uploads still running (their rows are cleaned up after a day)
	$effect(() => {
		if (!open) for (const xhr of Object.values(running)) xhr.abort();
	});

	// Closing the tab: one last save of what was typed since (a body too big for a beacon is lost)
	$effect(() => {
		if (!open) return;
		const last = () => {
			const data = dirty && !finished ? snapshot() : null;
			if (data) navigator.sendBeacon('?/saveDraft', data);
		};
		addEventListener('pagehide', last);
		return () => removeEventListener('pagehide', last);
	});

	/** What the drawer holds, as the saveDraft action reads it */
	function snapshot() {
		if (!formEl) return null;
		const data = new FormData(formEl);
		data.set('body', editor?.getHTML() ?? '');
		data.set('draftId', draftId);
		data.delete('uploads');
		for (const u of uploads) if (u.fileId && u.state === 'done') data.append('uploads', u.fileId);
		return data;
	}

	/** Something changed: save in a moment */
	function touch() {
		if (finished) return;
		dirty = true;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
	}

	/** Save now if anything changed; saves run one after another */
	function save() {
		clearTimeout(saveTimer);
		if (!dirty || finished) return saving;
		const data = snapshot();
		if (!data) return saving;
		dirty = false;
		saving = saving.then(async () => {
			saveState = 'saving';
			try {
				const res = await fetch('?/saveDraft', {
					method: 'POST',
					body: data,
					headers: { 'x-sveltekit-action': 'true' }
				});
				const result = deserialize(await res.text());
				if (result.type !== 'success') throw new Error('save failed');
				saved = !!result.data?.draftId;
				savedAt = new Date(String(result.data?.savedAt));
				saveState = saved ? 'saved' : 'idle';
				changed = true;
			} catch {
				saveState = 'error';
				dirty = true;
			}
		});
		return saving;
	}

	/** X, Esc, the overlay (the form is still there): keep what was written */
	function closed() {
		void save().then(() => {
			if (changed) onchanged?.();
		});
	}

	/** Buang draf: delete the saved draft and close */
	async function discard() {
		clearTimeout(saveTimer);
		finished = true;
		await saving;
		if (saved) {
			const data = new FormData();
			data.set('draftId', draftId);
			try {
				const res = await fetch('?/deleteDraft', {
					method: 'POST',
					body: data,
					headers: { 'x-sveltekit-action': 'true' }
				});
				const result = deserialize(await res.text());
				if (result.type !== 'success') {
					finished = false;
					toast.error(
						String((result.type === 'failure' && result.data?.error) || 'Draf gagal dibuang.')
					);
					return;
				}
			} catch {
				finished = false;
				toast.error('Draf gagal dibuang. Periksa koneksi lalu coba lagi.');
				return;
			}
		}
		open = false;
		if (saved) {
			onchanged?.();
			toast.success('Draf dibuang.');
		}
	}

	function openSchedule() {
		scheduling = true;
		queueMicrotask(() => schedulePanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
	}

	const saveText = $derived(
		saveState === 'saving'
			? 'Menyimpan draf…'
			: saveState === 'error'
				? 'Draf gagal disimpan'
				: saveState === 'saved' && savedAt
					? `Draf tersimpan ${dateID(savedAt, 'time')}`
					: ''
	);

	const fieldError = (name: string) => (error?.field === name ? [error.text] : undefined);

	function addFiles(list: File[]) {
		const blocked = list.filter((f) => isBlockedFile(f.name));
		if (blocked.length)
			toast.error(
				`${blocked.map((f) => f.name).join(', ')} tidak bisa dikirim: file program ditolak layanan email.`
			);
		const tooBig = list.filter((f) => f.size > EMAIL_FILE_MAX);
		if (tooBig.length)
			toast.error(
				`${tooBig.map((f) => f.name).join(', ')} lebih dari ${fileSize(EMAIL_FILE_MAX)}: kirim lewat layanan lain.`
			);
		const fresh = list.filter(
			(f) => !isBlockedFile(f.name) && f.size > 0 && f.size <= EMAIL_FILE_MAX
		);
		const room = EMAIL_MAX_FILES - uploads.length;
		if (fresh.length > room) toast.error(`Maksimal ${EMAIL_MAX_FILES} lampiran per email.`);
		for (const file of fresh.slice(0, Math.max(0, room))) {
			const u: Upload = {
				key: crypto.randomUUID(),
				name: file.name,
				size: file.size,
				file,
				fileId: null,
				progress: 0,
				state: 'uploading'
			};
			uploads.push(u);
			void upload(u.key);
		}
		if (error?.field === 'files') error = null;
	}

	const find = (key: string) => uploads.find((u) => u.key === key);

	function failed(key: string, message: string) {
		const u = find(key);
		if (u) Object.assign(u, { state: 'error', message });
		delete running[key];
	}

	/** Ask the server for a presigned PUT, then send the bytes there with progress */
	async function upload(key: string) {
		const u = find(key);
		if (!u?.file) return;
		const file = u.file;
		const data = new FormData();
		data.set('filename', file.name);
		data.set('size', String(file.size));
		data.set('contentType', file.type);
		let ticket: { fileId: string; url: string; contentType: string };
		try {
			const res = await fetch('?/upload', {
				method: 'POST',
				body: data,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type !== 'success') {
				failed(
					key,
					String((result.type === 'failure' && result.data?.error) || 'Gagal mengunggah.')
				);
				return;
			}
			ticket = result.data as typeof ticket;
		} catch {
			failed(key, 'Gagal mengunggah. Periksa koneksi lalu coba lagi.');
			return;
		}
		const xhr = new XMLHttpRequest();
		running[key] = xhr;
		xhr.open('PUT', ticket.url);
		xhr.setRequestHeader('content-type', ticket.contentType);
		xhr.upload.onprogress = (e) => {
			const current = find(key);
			if (current && e.lengthComputable) current.progress = e.loaded / e.total;
		};
		xhr.onload = () => {
			delete running[key];
			const current = find(key);
			if (!current) return;
			if (xhr.status >= 200 && xhr.status < 300) {
				Object.assign(current, { state: 'done', progress: 1, fileId: ticket.fileId });
				touch();
			} else failed(key, `Gagal mengunggah (${xhr.status}). Coba lagi.`);
		};
		xhr.onerror = () => failed(key, 'Gagal mengunggah. Periksa koneksi lalu coba lagi.');
		xhr.send(file);
	}

	function retry(key: string) {
		const u = find(key);
		if (!u) return;
		Object.assign(u, { state: 'uploading', progress: 0, message: undefined, fileId: null });
		void upload(key);
	}

	function removeUpload(key: string) {
		running[key]?.abort();
		delete running[key];
		const had = find(key)?.fileId;
		uploads = uploads.filter((u) => u.key !== key);
		if (had) touch();
	}

	const bodyLabelId = $derived(`${formId}-body-label`);
</script>

<Drawer bind:open {title} {description} onclose={closed}>
	<form
		bind:this={formEl}
		id={formId}
		method="post"
		action="?/send"
		enctype="multipart/form-data"
		class="flex flex-col gap-4"
		novalidate
		oninput={touch}
		use:enhance={async ({ formData, cancel, action }) => {
			const toSchedule = action.search === '?/schedule';
			error = null;
			const body = editor?.getHTML() ?? '';
			// A forward may go without a message of its own
			if (!body && !forward) {
				error = { text: 'Tulis isi email.', field: 'body' };
				editor?.focus();
				return cancel();
			}
			// Pictures travel inside the message, so they still count toward Vercel's request limit
			const size = uploadSize(body, []);
			if (size > EMAIL_UPLOAD_LIMIT) {
				error = {
					text: `Gambar di dalam pesan ${fileSize(size)}, maksimal ${fileSize(EMAIL_UPLOAD_LIMIT)}. Lampirkan gambar besar sebagai file.`,
					field: 'body'
				};
				return cancel();
			}
			if (busy) {
				error = { text: 'Tunggu sampai semua file selesai diunggah.', field: 'files' };
				return cancel();
			}
			if (uploads.some((u) => u.state === 'error')) {
				error = { text: 'Ada file yang gagal diunggah: coba lagi atau hapus.', field: 'files' };
				return cancel();
			}
			formData.set('body', body);
			formData.set('draftId', draftId);
			formData.delete('uploads');
			for (const u of uploads) if (u.fileId) formData.append('uploads', u.fileId);
			sending = true;
			// No save may land after this: the action deletes (send) or takes over (schedule) the draft
			clearTimeout(saveTimer);
			finished = true;
			await saving;
			return async ({ result }) => {
				sending = false;
				if (result.type === 'success') {
					open = false;
					key = crypto.randomUUID();
					uploads = [];
					if (toSchedule) await onscheduled?.();
					else await onsent(String(result.data?.threadId ?? threadId));
					toast.success(String(result.data?.done ?? 'Email terkirim.'));
					return;
				}
				finished = false;
				if (result.type === 'failure') {
					error = {
						text: String(
							result.data?.error ??
								(toSchedule ? 'Email gagal dijadwalkan.' : 'Email gagal dikirim.')
						),
						field: String(result.data?.field ?? '')
					};
				} else if (result.type === 'error') {
					error = { text: 'Email gagal dikirim. Coba lagi sebentar lagi.', field: '' };
				}
			};
		}}
	>
		<input type="hidden" name="threadId" value={forward ? '' : threadId} />
		<input type="hidden" name="key" value={key} />
		{#if forward}<input type="hidden" name="forwardId" value={forward.emailId} />{/if}

		{#if error && !['to', 'cc', 'subject', 'body', 'files', 'forwardFiles', 'sendAt'].includes(error.field)}
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

		<Field
			label="Subjek"
			name="subject"
			required={!threadId && !forward}
			errors={fieldError('subject')}
		>
			{#snippet children(attrs)}
				<input {...attrs} type="text" defaultValue={subject} maxlength="250" />
			{/snippet}
		</Field>

		<!-- bf-field markup by hand: the editor is a contenteditable, labelled by id -->
		<div class="bf-field">
			<span id={bodyLabelId}
				>Pesan{#if !forward}<span class="text-danger" aria-hidden="true"> *</span>{/if}</span
			>
			<RichTextEditor
				bind:this={editor}
				id="{formId}-body"
				labelledby={bodyLabelId}
				describedby={fieldError('body') ? `${formId}-body-error` : `${formId}-body-hint`}
				invalid={!!fieldError('body')}
				content={draft?.body}
				onfiles={addFiles}
				onchange={() => {
					bodyWeight = editor?.weight() ?? 0;
					if (error?.field === 'body') error = null;
					touch();
				}}
			/>
			{#if fieldError('body')}
				<span id="{formId}-body-error" class="bf-field__error">{error?.text}</span>
			{:else}
				<span id="{formId}-body-hint" class="bf-field__hint">
					Tempel, seret atau sisipkan gambar langsung di dalam pesan.
					{#if forward}
						Email yang diteruskan disertakan di bawah pesan Anda; pesan boleh dikosongkan.
					{:else if threadId}Email sebelumnya dikutip otomatis di bawah pesan Anda.{/if}
				</span>
			{/if}
		</div>

		{#if forward?.attachments.length}
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-2 text-small font-bold text-ink-2">Lampiran email asli</legend>
				{#each forward.attachments as a (a.id)}
					<label
						class="flex items-center gap-2 rounded-control bg-tint-2 px-3 py-2 text-small {forward.expired
							? 'opacity-60'
							: ''}"
					>
						<input
							type="checkbox"
							name="forwardFiles"
							value={a.id}
							checked={!forward.expired && (!draft || draft.forwardFiles.includes(a.id))}
							disabled={forward.expired}
						/>
						<Paperclip size={14} strokeWidth={2} class="shrink-0 text-ink-3" />
						<span class="min-w-0 flex-1 truncate font-bold text-ink">{a.filename}</span>
						<span class="shrink-0 text-ink-3">{fileSize(a.size)}</span>
					</label>
				{/each}
				{#if forward.expired}
					<p class="text-small text-ink-3">
						Lampiran ini sudah tidak tersedia: Resend menyimpan file {RESEND_RETENTION_DAYS} hari. Email
						tetap bisa diteruskan tanpa lampiran.
					</p>
				{/if}
				{#if fieldError('forwardFiles')}
					<p role="alert" class="bf-field__error">{error?.text}</p>
				{/if}
			</fieldset>
		{/if}

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
				<span class="text-small text-ink-3">Maksimal {fileSize(EMAIL_FILE_MAX)} per file</span>
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
			{#if uploads.length}
				<ul class="flex flex-col gap-1.5" aria-label="Lampiran">
					{#each uploads as u (u.key)}
						<li class="flex flex-col gap-1 rounded-control bg-tint-2 py-1.5 pr-1 pl-3 text-small">
							<div class="flex items-center gap-2">
								<Paperclip size={14} strokeWidth={2} class="shrink-0 text-ink-3" />
								<span class="min-w-0 flex-1 truncate font-bold text-ink">{u.name}</span>
								<span class="shrink-0 text-ink-3">{fileSize(u.size)}</span>
								{#if u.state === 'done'}
									<span
										class={[
											'bf-chip shrink-0',
											asLink.has(u.key) ? 'bf-chip--accent' : 'bf-chip--success'
										]}>{asLink.has(u.key) ? 'Link unduhan' : 'Lampiran'}</span
									>
								{/if}
								<button
									type="button"
									class="bf-icon-btn size-8! shrink-0 border-0! bg-transparent!"
									aria-label="Hapus lampiran {u.name}"
									onclick={() => removeUpload(u.key)}
								>
									<X size={14} strokeWidth={2} />
								</button>
							</div>
							{#if u.state === 'uploading'}
								<div class="mr-2 flex items-center gap-2">
									<progress
										class="h-1.5 min-w-0 flex-1 accent-accent"
										max="1"
										value={u.progress}
										aria-label="Mengunggah {u.name}"
									></progress>
									<span class="w-10 shrink-0 text-right font-mono text-[11px] text-ink-3"
										>{Math.round(u.progress * 100)}%</span
									>
								</div>
							{:else if u.state === 'error'}
								<p class="mr-2 flex flex-wrap items-center gap-x-2 text-danger">
									{u.message}
									<button
										type="button"
										class="font-bold text-accent-ink hover:underline"
										onclick={() => retry(u.key)}>Coba lagi</button
									>
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if fieldError('files')}
				<p role="alert" class="bf-field__error">{error?.text}</p>
			{/if}
			<p class="text-small text-ink-3">
				File sampai {fileSize(EMAIL_ATTACH_BUDGET)} (semua lampiran digabung) dikirim sebagai lampiran;
				yang lebih besar dikirim sebagai link unduhan yang berlaku {EMAIL_FILE_LINK_DAYS} hari. File bisa
				diunduh lagi dari CRM selama {EMAIL_FILE_LINK_DAYS} hari.
			</p>
		</div>

		{#if scheduling}
			<fieldset
				bind:this={schedulePanel}
				class="flex flex-col gap-3 rounded-control bg-tint-2 p-4"
				aria-describedby="{formId}-schedule-hint"
			>
				<legend class="sr-only">Jadwalkan kirim</legend>
				<p class="text-small font-bold text-ink-2" aria-hidden="true">Jadwalkan kirim</p>
				<div class="flex flex-wrap gap-2">
					{#each choices as c (c.label)}
						{@const active = sendDate === c.date && sendTime === c.time}
						<button
							type="button"
							class={['bf-chip px-3! py-1.5!', active && 'bg-navy! text-on-accent!']}
							aria-pressed={active}
							onclick={() => {
								sendDate = c.date;
								sendTime = c.time;
							}}>{c.label} · {dateID(c.date, 'day')} {c.time}</button
						>
					{/each}
				</div>
				<div class="grid grid-cols-2 gap-3 *:min-w-0">
					<div class="bf-field">
						<label for="{formId}-send-date">Tanggal</label>
						<input
							id="{formId}-send-date"
							type="date"
							name="sendDate"
							min={dayKeyWib()}
							bind:value={sendDate}
							required
						/>
					</div>
					<div class="bf-field">
						<label for="{formId}-send-time">Jam (WIB)</label>
						<input
							id="{formId}-send-time"
							type="time"
							name="sendTime"
							bind:value={sendTime}
							required
						/>
					</div>
				</div>
				{#if fieldError('sendAt')}
					<p role="alert" class="bf-field__error">{error?.text}</p>
				{/if}
				<p id="{formId}-schedule-hint" class="text-small text-ink-3">
					Email dikirim otomatis pada waktu ini. Sampai saat itu email ada di Terjadwal dan masih
					bisa diubah atau dibatalkan.
				</p>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="bf-btn bf-btn--secondary bf-btn--sm"
						onclick={() => (scheduling = false)}>Batal</button
					>
					<button
						type="submit"
						formaction="?/schedule"
						class="bf-btn bf-btn--primary bf-btn--sm"
						disabled={sending}
					>
						<Clock size={14} strokeWidth={2} />
						Jadwalkan kirim
					</button>
				</div>
			</fieldset>
		{/if}

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
		<div class="mr-auto flex min-w-0 items-center gap-2">
			<button
				type="button"
				class="bf-icon-btn shrink-0"
				aria-label="Buang draf"
				title="Buang draf"
				onclick={discard}
				disabled={sending}
			>
				<Trash2 size={18} strokeWidth={1.75} />
			</button>
			<span
				class={[
					'min-w-0 truncate text-small',
					saveState === 'error' ? 'text-danger' : 'text-ink-3'
				]}
				aria-live="polite">{saveText}</span
			>
		</div>
		{#if canSchedule}
			<button
				type="button"
				class="bf-btn bf-btn--secondary shrink-0"
				aria-expanded={scheduling}
				onclick={openSchedule}
			>
				<Clock size={16} strokeWidth={2} />
				<span class="max-sm:sr-only">Jadwalkan</span>
			</button>
		{/if}
		<button type="submit" form={formId} class="bf-btn bf-btn--primary shrink-0" disabled={sending}>
			<Send size={16} strokeWidth={2} />
			{sending ? 'Mengirim…' : 'Kirim'}
		</button>
	{/snippet}
</Drawer>
