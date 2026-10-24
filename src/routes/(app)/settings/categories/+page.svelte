<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { TXN_TYPE_LABELS, TXN_TYPES } from '#lib/constants.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let editing = $state<string | null>(null);
	/** New-category inputs are cleared after a successful add */
	let draft = $state<Record<string, string>>({ income: '', expense: '' });
</script>

<Topbar title="Kategori" />

<main class="page-body gap-5!">
	<a
		href={resolve('settings')}
		class="inline-flex min-h-(--size-touch) w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Pengaturan
	</a>

	<div class="grid gap-5 *:min-w-0 lg:grid-cols-2">
		{#each TXN_TYPES as type (type)}
			{@const items = data.categories.filter((c) => c.type === type)}
			<section class="flex flex-col gap-3 rounded-card bg-surface p-5" aria-labelledby="cat-{type}">
				<div class="flex items-baseline justify-between gap-2">
					<h2 id="cat-{type}" class="text-section-title">{TXN_TYPE_LABELS[type].long}</h2>
					<span class="text-small text-ink-3">{items.length} kategori</span>
				</div>
				{#if type === 'expense'}
					<p class="text-small text-ink-2">
						Kategori <b>Overhead</b> untuk biaya kantor tanpa klien (gaji, sewa). Transaksinya tidak terkait
						klien dan masuk ke Laba Rugi sebagai overhead. Ditentukan saat kategori dibuat.
					</p>
				{/if}
				<ul class="flex flex-col">
					{#each items as c, i (c.id)}
						<li class="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
							{#if editing === c.id}
								<form
									method="post"
									action="?/save"
									class="flex min-w-0 flex-1 items-center gap-2"
									use:enhance={refreshThenToast({ end: (ok) => ok && (editing = null) })}
								>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="type" value={c.type} />
									<label class="sr-only" for="rename-{c.id}">Nama baru untuk {c.name}</label>
									<input
										id="rename-{c.id}"
										name="name"
										defaultValue={c.name}
										maxlength="60"
										class="min-h-9 min-w-0 flex-1 rounded-control border border-line px-3 text-body"
									/>
									<button type="submit" class="bf-btn bf-btn--primary bf-btn--sm">Simpan</button>
									<button
										type="button"
										class="bf-btn bf-btn--ghost bf-btn--sm"
										onclick={() => (editing = null)}>Batal</button
									>
								</form>
							{:else}
								<span class="min-w-0 flex-1">
									<span class="block truncate font-semibold">{c.name}</span>
									<span class="text-small text-ink-3"
										>{#if c.isOverhead}<span class="bf-chip mr-1.5 py-0!">Overhead</span
											>{/if}{c.used ? `${c.used} transaksi` : 'Belum dipakai'}</span
									>
								</span>
								<form method="post" action="?/move" use:enhance={refreshThenToast()} class="flex">
									<input type="hidden" name="id" value={c.id} />
									<button
										type="submit"
										name="direction"
										value="up"
										class="bf-icon-btn size-8! disabled:invisible"
										aria-label="Naikkan {c.name}"
										disabled={i === 0}><ChevronUp size={15} strokeWidth={2} /></button
									>
									<button
										type="submit"
										name="direction"
										value="down"
										class="bf-icon-btn size-8! disabled:invisible"
										aria-label="Turunkan {c.name}"
										disabled={i === items.length - 1}
										><ChevronDown size={15} strokeWidth={2} /></button
									>
								</form>
								<button
									type="button"
									class="bf-icon-btn size-8!"
									aria-label="Ganti nama {c.name}"
									onclick={() => (editing = c.id)}><Pencil size={14} strokeWidth={1.8} /></button
								>
								<form method="post" action="?/delete" use:enhance={refreshThenToast()}>
									<input type="hidden" name="id" value={c.id} />
									<button
										type="submit"
										class="bf-icon-btn size-8! disabled:opacity-40"
										aria-label="Hapus {c.name}"
										title={c.used ? 'Dipakai transaksi; ganti nama saja' : 'Hapus'}
										disabled={c.used > 0}><Trash size={14} strokeWidth={1.8} /></button
									>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
				<form
					method="post"
					action="?/save"
					class="flex flex-wrap items-center gap-2 border-t border-line pt-3"
					use:enhance={refreshThenToast({ end: (ok) => ok && (draft[type] = '') })}
				>
					<input type="hidden" name="type" value={type} />
					<label class="sr-only" for="new-{type}"
						>Kategori {TXN_TYPE_LABELS[type].long.toLowerCase()} baru</label
					>
					<input
						id="new-{type}"
						name="name"
						bind:value={draft[type]}
						maxlength="60"
						placeholder="Kategori baru"
						class="min-h-10 min-w-0 flex-1 rounded-control border border-line px-3 text-body"
					/>
					{#if type === 'expense'}
						<label
							class="flex min-h-10 items-center gap-2 text-small font-semibold text-ink-2"
							title="Biaya kantor yang tidak terkait klien, mis. gaji atau sewa"
						>
							<input type="checkbox" name="isOverhead" class="size-4 accent-accent" />
							Overhead
						</label>
					{/if}
					<button
						type="submit"
						class="bf-btn bf-btn--secondary bf-btn--sm"
						disabled={!draft[type].trim()}
					>
						<Plus size={14} strokeWidth={2} />
						Tambah
					</button>
				</form>
			</section>
		{/each}
	</div>
</main>
