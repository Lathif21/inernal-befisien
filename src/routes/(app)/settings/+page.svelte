<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Send from '@lucide/svelte/icons/send';
	import Tags from '@lucide/svelte/icons/tags';
	import Users from '@lucide/svelte/icons/users';
	import Topbar from '#lib/components/layout/Topbar.svelte';

	// Sections of docs/03-SCREENS.md §10; the rest arrive with P1-12 (Telegram) and P1-13
	const LATER = [
		{
			icon: Users,
			title: 'Pengguna',
			text: 'Tambah pengguna, reset kata sandi, ringkasan harian.'
		},
		{ icon: Tags, title: 'Kategori', text: 'Kategori pemasukan dan pengeluaran.' },
		{ icon: Send, title: 'Telegram', text: 'Hubungkan akun Telegram untuk pengingat.' }
	];
</script>

<Topbar title="Pengaturan" />

<main class="page-body">
	<ul class="grid gap-4 md:grid-cols-2">
		<li>
			<a
				href={resolve('settings/import')}
				class="flex items-center gap-4 rounded-card bg-surface p-5 text-ink no-underline hover:shadow-raised"
			>
				<span
					class="grid size-11 shrink-0 place-items-center rounded-control bg-tint text-accent-ink"
				>
					<FileUp size={20} strokeWidth={1.9} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-card-title">Import Data</span>
					<span class="block text-small text-ink-2"
						>Pindahkan klien, kontak, dan deal dari file CSV.</span
					>
				</span>
				<ChevronRight size={18} strokeWidth={2} class="text-ink-3" />
			</a>
		</li>
		{#each LATER as s (s.title)}
			<li class="flex items-center gap-4 rounded-card bg-surface p-5 opacity-70">
				<span class="grid size-11 shrink-0 place-items-center rounded-control bg-tint-2 text-ink-3">
					<s.icon size={20} strokeWidth={1.9} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block text-card-title">{s.title}</span>
					<span class="block text-small text-ink-2">{s.text}</span>
				</span>
				<span class="bf-chip">Segera</span>
			</li>
		{/each}
	</ul>
</main>
