<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Building from '@lucide/svelte/icons/building-2';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FileUp from '@lucide/svelte/icons/file-up';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Send from '@lucide/svelte/icons/send';
	import Tags from '@lucide/svelte/icons/tags';
	import Users from '@lucide/svelte/icons/users';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { toast } from '#lib/toast.ts';
	import { dateID } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Other sections of docs/03-SCREENS.md §10
	const SECTIONS = [
		{
			href: resolve('settings/users'),
			icon: Users,
			title: 'Pengguna',
			text: 'Tambah pengguna, reset kata sandi, ringkasan harian.'
		},
		{
			href: resolve('settings/categories'),
			icon: Tags,
			title: 'Kategori',
			text: 'Kategori pemasukan dan pengeluaran.'
		},
		{
			href: resolve('settings/company'),
			icon: Building,
			title: 'Profil perusahaan',
			text: 'Nama, alamat, NPWP, rekening bank, dan penanda tangan di PDF invoice.'
		},
		{
			href: resolve('settings/import'),
			icon: FileUp,
			title: 'Import Data',
			text: 'Pindahkan klien, kontak, dan deal dari file CSV.'
		}
	];

	let busy = $state<string | null>(null);
	const track = (name: string) =>
		refreshThenToast({ start: () => (busy = name), end: () => (busy = null) });

	/** Digest switches: a refused save keeps what the person ticked (no reload on failure) */
	const saveDigest: SubmitFunction = () => {
		busy = 'save';
		return async ({ result, update }) => {
			busy = null;
			if (result.type === 'failure') {
				toast.error(String(result.data?.error));
				return;
			}
			await update({ navigate: false, reset: false });
			if (result.type === 'success') toast.success(String(result.data?.done));
		};
	};

	// Digest form: local copy, saved with "Simpan"
	let enabled = $derived(data.me.digestEnabled);
	let telegram = $derived(data.me.digestChannels.includes('telegram'));
	let email = $derived(data.me.digestChannels.includes('email'));
</script>

<Topbar title="Pengaturan" />

<main class="page-body gap-6!">
	<!-- Telegram + daily digest (P1-12) -->
	<section class="flex flex-col gap-5 rounded-card bg-surface p-5" aria-labelledby="digest-title">
		<div class="flex flex-col gap-1">
			<h2 id="digest-title" class="text-section-title">Ringkasan harian & Telegram</h2>
			<p class="text-small text-ink-2">
				Setiap hari pukul 07:30 WIB: langkah Anda yang terlambat, jatuh tempo hari ini (dengan jam),
				dan besok. Tidak dikirim jika tidak ada.
			</p>
		</div>

		<div class="grid gap-5 *:min-w-0 lg:grid-cols-2">
			<!-- Telegram link -->
			<div class="flex flex-col gap-3 rounded-kanban border border-line p-4">
				<div class="flex flex-wrap items-center gap-2">
					<Send size={18} strokeWidth={1.9} class="text-accent-ink" aria-hidden="true" />
					<h3 class="text-card-title">Telegram</h3>
					{#if data.me.telegramLinked}
						<span class="bf-chip bf-chip--success ml-auto">Terhubung</span>
					{:else}
						<span class="bf-chip ml-auto">Belum terhubung</span>
					{/if}
				</div>

				{#if !data.bot}
					<p class="text-small text-danger">TELEGRAM_BOT_USERNAME belum diatur di server.</p>
				{:else if data.me.telegramLinked}
					<p class="text-small text-ink-2">
						Ringkasan dikirim ke chat Anda dengan @{data.bot}. Kirim /stop di Telegram atau putuskan
						di sini.
					</p>
					<p class="text-small text-ink-2">
						Anda juga bisa mencatat lewat chat atau voice note ke bot: lead baru, langkah, pindah
						tahap deal, rencana strategi, atau catatan klien. Bot mengirim draf dulu; data tersimpan
						setelah Anda menekan <b>Simpan</b>. Kirim /bantuan untuk contoh.
					</p>
					<form method="post" action="?/unlinkTelegram" use:enhance={track('unlink')}>
						<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm" disabled={!!busy}
							>Putuskan Telegram</button
						>
					</form>
				{:else if data.pending}
					<ol class="flex list-decimal flex-col gap-1.5 pl-5 text-small text-ink-2">
						<li>Buka bot di Telegram, lalu tekan <b>Start</b>.</li>
						<li>Kembali ke sini dan klik <b>Cek status</b>.</li>
					</ol>
					<div class="flex flex-wrap items-center gap-2">
						<!-- eslint-disable svelte/no-navigation-without-resolve -- external t.me link -->
						<a
							href={data.pending.link}
							target="_blank"
							rel="noopener noreferrer"
							class="bf-btn bf-btn--primary bf-btn--sm"
						>
							Buka @{data.bot}
							<ExternalLink size={14} strokeWidth={2} />
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
						<button
							type="button"
							class="bf-btn bf-btn--secondary bf-btn--sm"
							onclick={() => invalidateAll()}
						>
							<RefreshCw size={14} strokeWidth={2} />
							Cek status
						</button>
					</div>
					<p class="text-small text-ink-3">
						Kode <span class="font-mono font-bold text-ink">{data.pending.code}</span> berlaku
						sampai
						{dateID(data.pending.expiresAt, 'time')} WIB. Atau kirim
						<span class="font-mono">/start {data.pending.code}</span> ke @{data.bot}.
					</p>
				{:else}
					<p class="text-small text-ink-2">
						Hubungkan sekali untuk menerima ringkasan di Telegram (@{data.bot}) dan mencatat data
						lewat chat atau voice note.
					</p>
					<form method="post" action="?/linkTelegram" use:enhance={track('link')}>
						<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm" disabled={!!busy}>
							<Send size={14} strokeWidth={2} />
							Hubungkan Telegram
						</button>
					</form>
				{/if}
			</div>

			<!-- Digest switches -->
			<form
				method="post"
				action="?/saveDigest"
				use:enhance={saveDigest}
				class="flex flex-col gap-3 rounded-kanban border border-line p-4"
			>
				<h3 class="text-card-title">Pengiriman</h3>
				<label class="inline-flex items-center gap-2.5 text-body font-semibold">
					<input
						type="checkbox"
						name="enabled"
						bind:checked={enabled}
						class="size-5 accent-accent"
					/>
					Kirim ringkasan harian
				</label>
				<fieldset class="flex flex-col gap-2 pl-7" disabled={!enabled}>
					<legend class="sr-only">Saluran</legend>
					<label class="inline-flex items-center gap-2.5 text-body">
						<input
							type="checkbox"
							name="telegram"
							bind:checked={telegram}
							class="size-4 accent-accent"
						/>
						Telegram
						{#if !data.me.telegramLinked}<span class="text-small text-ink-3">(hubungkan dulu)</span
							>{/if}
					</label>
					<label class="inline-flex items-center gap-2.5 text-body">
						<input type="checkbox" name="email" bind:checked={email} class="size-4 accent-accent" />
						Email <span class="text-small text-ink-3">({data.me.email})</span>
					</label>
				</fieldset>
				<div class="mt-auto flex flex-wrap gap-2 pt-1">
					<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm" disabled={!!busy}
						>Simpan</button
					>
				</div>
			</form>
		</div>

		<form
			method="post"
			action="?/testDigest"
			use:enhance={track('test')}
			class="flex flex-wrap items-center gap-3 border-t border-line pt-4"
		>
			<button type="submit" class="bf-btn bf-btn--secondary bf-btn--sm" disabled={!!busy}>
				{busy === 'test' ? 'Mengirim…' : 'Kirim tes sekarang'}
			</button>
			<span class="text-small text-ink-3"
				>Mengirim ringkasan Anda saat ini lewat saluran yang aktif, sama seperti pukul 07:30.</span
			>
		</form>
	</section>

	<ul class="grid gap-4 *:min-w-0 md:grid-cols-3">
		{#each SECTIONS as s (s.title)}
			<li>
				<a
					href={s.href}
					class="flex h-full items-center gap-4 rounded-card bg-surface p-5 text-ink no-underline hover:shadow-raised"
				>
					<span
						class="grid size-11 shrink-0 place-items-center rounded-control bg-tint text-accent-ink"
					>
						<s.icon size={20} strokeWidth={1.9} />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-card-title">{s.title}</span>
						<span class="block text-small text-ink-2">{s.text}</span>
					</span>
					<ChevronRight size={18} strokeWidth={2} class="text-ink-3" />
				</a>
			</li>
		{/each}
	</ul>
</main>
