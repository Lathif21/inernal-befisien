<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Avatar from '#lib/components/Avatar.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import Field from '#lib/components/form/Field.svelte';
	import Drawer from '#lib/components/layout/Drawer.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { USER_ROLE_LABELS, USER_ROLES } from '#lib/constants.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { dateID } from '#lib/format.ts';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Credentials = { name: string; email: string; password: string };

	let addOpen = $state(false);
	let addErrors = $state<Record<string, string>>({});
	let resetFor = $state<{ id: string; name: string } | null>(null);
	let resetOpen = $state(false);
	let resetErrors = $state<Record<string, string>>({});
	let shown = $state<Credentials | null>(null);
	let shownOpen = $state(false);
	let busy = $state(false);

	/** Add / reset: field errors stay in the form; a generated password is shown once */
	const submit =
		(kind: 'add' | 'reset'): SubmitFunction =>
		() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'failure') {
					const fields = (result.data?.fields ?? {}) as Record<string, string>;
					if (kind === 'add') addErrors = fields;
					else resetErrors = fields;
					if (result.data?.error) toast.error(String(result.data.error));
					return;
				}
				if (result.type !== 'success') return;
				await update({ navigate: false });
				if (kind === 'add') {
					addOpen = false;
					addErrors = {};
				} else {
					resetOpen = false;
					resetErrors = {};
				}
				toast.success(String(result.data?.done));
				const creds = result.data?.credentials as Credentials | null;
				if (creds) {
					shown = creds;
					shownOpen = true;
				}
			};
		};

	function openReset(u: { id: string; name: string }) {
		resetFor = u;
		resetErrors = {};
		resetOpen = true;
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Kata sandi disalin.');
		} catch {
			toast.error('Tidak bisa menyalin. Salin manual.');
		}
	}
</script>

<Topbar title="Pengguna">
	{#snippet actions()}
		<button
			type="button"
			class="bf-btn bf-btn--primary"
			onclick={() => {
				addErrors = {};
				addOpen = true;
			}}
		>
			<UserPlus size={17} strokeWidth={1.9} />
			Pengguna
		</button>
	{/snippet}
</Topbar>

<main class="page-body gap-5!">
	<a
		href={resolve('settings')}
		class="inline-flex min-h-(--size-touch) w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Pengaturan
	</a>

	<section class="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5" aria-label="Pengguna">
		<p class="text-small text-ink-2">
			Pendaftaran publik dimatikan. Orang baru masuk lewat daftar ini. Telegram dihubungkan oleh
			masing-masing pengguna di Pengaturan miliknya.
		</p>
		<div class="bf-table-wrap min-w-0">
			<table class="bf-table min-w-180">
				<thead>
					<tr>
						<th scope="col">Nama</th>
						<th scope="col">Peran</th>
						<th scope="col">Telegram</th>
						<th scope="col">Ringkasan harian</th>
						<th scope="col">Sejak</th>
						<th scope="col"><span class="sr-only">Aksi</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.users as u (u.id)}
						<tr>
							<td>
								<span class="flex items-center gap-2.5">
									<Avatar name={u.name} size={30} />
									<span class="min-w-0">
										<span class="block font-bold"
											>{u.name}{#if u.id === data.meId}<span class="ml-1.5 text-small text-ink-3"
													>(Anda)</span
												>{/if}</span
										>
										<span class="block text-small text-ink-3">{u.email}</span>
									</span>
								</span>
							</td>
							<td><span class="bf-chip">{USER_ROLE_LABELS[u.role]}</span></td>
							<td>
								{#if u.telegramLinked}<span class="bf-chip bf-chip--success">Terhubung</span
									>{:else}<span class="text-small text-ink-3">Belum</span>{/if}
							</td>
							<td>
								<form method="post" action="?/setDigest" use:enhance={refreshThenToast()}>
									<input type="hidden" name="userId" value={u.id} />
									<input type="hidden" name="enabled" value={u.digestEnabled ? 'false' : 'true'} />
									<button
										type="submit"
										role="switch"
										aria-checked={u.digestEnabled}
										aria-label="Ringkasan harian untuk {u.name}"
										class={[
											'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
											u.digestEnabled ? 'bg-accent' : 'bg-line-strong'
										]}
									>
										<span
											class={[
												'inline-block size-5 rounded-full bg-surface shadow transition-transform',
												u.digestEnabled ? 'translate-x-5.5' : 'translate-x-0.5'
											]}
										></span>
									</button>
								</form>
							</td>
							<td class="text-small whitespace-nowrap">{dateID(u.createdAt)}</td>
							<td class="text-right">
								<button
									type="button"
									class="bf-btn bf-btn--secondary bf-btn--sm"
									onclick={() => openReset(u)}
								>
									<KeyRound size={14} strokeWidth={2} />
									Reset kata sandi
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</main>

<Drawer
	bind:open={addOpen}
	title="Tambah pengguna"
	description="Langsung bisa masuk dengan email ini."
>
	<form
		id="add-user"
		method="post"
		action="?/addUser"
		use:enhance={submit('add')}
		class="flex flex-col gap-4"
		novalidate
	>
		<Field label="Nama" name="name" required errors={addErrors.name ? [addErrors.name] : undefined}>
			{#snippet children(attrs)}
				<input {...attrs} autocomplete="off" maxlength="80" />
			{/snippet}
		</Field>
		<Field
			label="Email"
			name="email"
			required
			errors={addErrors.email ? [addErrors.email] : undefined}
		>
			{#snippet children(attrs)}
				<input {...attrs} type="email" autocomplete="off" maxlength="200" />
			{/snippet}
		</Field>
		<Field label="Peran" name="role" hint="Fase 1: semua peran punya akses penuh">
			{#snippet children(attrs)}
				<select {...attrs}>
					{#each USER_ROLES as r (r)}<option value={r}>{USER_ROLE_LABELS[r]}</option>{/each}
				</select>
			{/snippet}
		</Field>
		<Field
			label="Kata sandi"
			name="password"
			hint="Kosongkan agar dibuat otomatis (ditampilkan sekali)"
			errors={addErrors.password ? [addErrors.password] : undefined}
		>
			{#snippet children(attrs)}
				<input {...attrs} type="password" autocomplete="new-password" maxlength="128" />
			{/snippet}
		</Field>
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (addOpen = false)}
			>Batal</button
		>
		<button type="submit" form="add-user" class="bf-btn bf-btn--primary" disabled={busy}>
			{busy ? 'Menyimpan…' : 'Tambah pengguna'}
		</button>
	{/snippet}
</Drawer>

<Modal bind:open={resetOpen} title="Reset kata sandi" description={resetFor?.name}>
	<form
		id="reset-password"
		method="post"
		action="?/resetPassword"
		use:enhance={submit('reset')}
		class="flex flex-col gap-4"
		novalidate
	>
		<input type="hidden" name="userId" value={resetFor?.id ?? ''} />
		<p class="text-body text-ink-2">
			Kata sandi lama berhenti berlaku dan {resetFor?.name ?? 'pengguna ini'} keluar dari semua perangkat.
		</p>
		<Field
			label="Kata sandi baru"
			name="password"
			hint="Kosongkan agar dibuat otomatis (ditampilkan sekali)"
			errors={resetErrors.password ? [resetErrors.password] : undefined}
		>
			{#snippet children(attrs)}
				<input {...attrs} type="password" autocomplete="new-password" maxlength="128" />
			{/snippet}
		</Field>
	</form>
	{#snippet footer()}
		<button type="button" class="bf-btn bf-btn--secondary" onclick={() => (resetOpen = false)}
			>Batal</button
		>
		<button type="submit" form="reset-password" class="bf-btn bf-btn--dark" disabled={busy}>
			{busy ? 'Menyimpan…' : 'Ganti kata sandi'}
		</button>
	{/snippet}
</Modal>

<Modal bind:open={shownOpen} title="Kata sandi baru" description={shown?.name} tone="bg-success-bg">
	{#if shown}
		<div class="flex flex-col gap-3">
			<p class="text-body text-ink-2">
				Berikan kata sandi ini ke {shown.name}{shown.email ? ` (${shown.email})` : ''}. Simpan
				sekarang: tidak akan ditampilkan lagi.
			</p>
			<div class="flex items-center gap-2 rounded-control border border-line bg-tint-2 px-3 py-2.5">
				<code
					class="min-w-0 flex-1 font-mono text-[15px] font-bold break-all"
					data-testid="new-password">{shown.password}</code
				>
				<button
					type="button"
					class="bf-icon-btn"
					aria-label="Salin kata sandi"
					onclick={() => copy(shown!.password)}
				>
					<Copy size={15} strokeWidth={1.9} />
				</button>
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<button
			type="button"
			class="bf-btn bf-btn--primary"
			onclick={() => {
				shownOpen = false;
				shown = null;
			}}>Sudah disimpan</button
		>
	{/snippet}
</Modal>
