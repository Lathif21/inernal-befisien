<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import {
		AI_FREQUENCIES,
		AI_FREQUENCY_LABELS,
		AI_TIMES,
		nextRun,
		scheduleText,
		suggestionTtlDays,
		WEEKDAY_LABELS,
		type AiFrequency
	} from '#lib/ai-schedule.ts';
	import { refreshThenToast } from '#lib/enhance.ts';
	import { dateID } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Local copy of the form, saved with "Simpan"
	let enabled = $derived(data.settings.enabled);
	let frequency = $derived<AiFrequency>(data.settings.frequency);
	let time = $derived(data.settings.time);
	let weekday = $derived(data.settings.weekday);
	let monthDay = $derived(data.settings.monthDay);
	let saving = $state(false);

	const draft = $derived({ ...data.settings, enabled, frequency, time, weekday, monthDay });
	const next = $derived(nextRun(draft));
	const when = (d: Date) => `${dateID(d, 'long')} pukul ${dateID(d, 'time')} WIB`;
</script>

<Topbar title="Saran AI" />

<main class="page-body gap-5!">
	<a
		href={resolve('settings')}
		class="inline-flex min-h-(--size-touch) w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Pengaturan
	</a>

	{#if !data.keySet}
		<p class="rounded-control bg-warning-bg px-4 py-3 text-small font-semibold text-ink">
			Kunci AI belum diatur di server (SUMOPOD_API_KEY), jadi Saran AI belum bisa berjalan.
		</p>
	{/if}

	<form
		method="post"
		action="?/save"
		class="flex max-w-2xl flex-col gap-5"
		use:enhance={refreshThenToast({ start: () => (saving = true), end: () => (saving = false) })}
	>
		<section class="flex flex-col gap-4 rounded-card bg-surface p-5" aria-labelledby="ai-on-title">
			<div class="flex items-start justify-between gap-4">
				<div class="flex flex-col gap-1">
					<h2 id="ai-on-title" class="text-section-title">Saran AI</h2>
					<p class="text-small text-ink-2">
						Saran tindakan per klien di Strategi dan halaman klien, dari riwayat dan Ringkasan
						konteks. Saran hanya dipakai setelah Anda menerimanya.
					</p>
				</div>
				<label class="flex min-h-(--size-touch) shrink-0 items-center gap-2 text-body font-bold">
					<input
						type="checkbox"
						name="enabled"
						bind:checked={enabled}
						class="size-5 accent-accent"
					/>
					{enabled ? 'Aktif' : 'Mati'}
				</label>
			</div>
			{#if !enabled}
				<p class="rounded-control bg-tint-2 px-3.5 py-2.5 text-small font-semibold text-ink-2">
					Saat mati: tidak ada saran baru, tombol "Minta saran AI" disembunyikan, dan panel Saran AI
					menampilkan "dimatikan". Ringkasan konteks klien dan chat strategi di Telegram tetap
					berjalan.
				</p>
			{/if}
		</section>

		<section
			class="flex flex-col gap-4 rounded-card bg-surface p-5"
			aria-labelledby="ai-when-title"
		>
			<div class="flex flex-col gap-1">
				<h2 id="ai-when-title" class="text-section-title">Jadwal</h2>
				<p class="text-small text-ink-2">
					Kapan AI meninjau semua klien yang aktif. Ringkasan konteks klien ikut diperbarui pada
					jadwal ini (juga saat Saran AI mati).
				</p>
			</div>

			<fieldset class="flex flex-wrap gap-2">
				<legend class="sr-only">Frekuensi</legend>
				{#each AI_FREQUENCIES as f (f)}
					<label
						class={[
							'flex min-h-(--size-touch) cursor-pointer items-center gap-2 rounded-control border px-3.5 text-body font-semibold',
							frequency === f ? 'border-accent bg-tint-2 text-accent-ink' : 'border-line'
						]}
					>
						<input
							type="radio"
							name="frequency"
							value={f}
							bind:group={frequency}
							class="accent-accent"
						/>
						{AI_FREQUENCY_LABELS[f]}
					</label>
				{/each}
			</fieldset>

			{#if frequency !== 'manual'}
				<div class="grid gap-4 *:min-w-0 sm:grid-cols-2">
					{#if frequency === 'weekly'}
						<div class="bf-field">
							<label for="ai-weekday">Hari</label>
							<select id="ai-weekday" name="weekday" bind:value={weekday}>
								{#each WEEKDAY_LABELS as d, i (d)}<option value={i + 1}>{d}</option>{/each}
							</select>
						</div>
					{:else if frequency === 'monthly'}
						<div class="bf-field">
							<label for="ai-month-day">Tanggal</label>
							<select id="ai-month-day" name="monthDay" bind:value={monthDay}>
								{#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}<option value={d}
										>{d}</option
									>{/each}
							</select>
							{#if monthDay > 28}<span class="bf-field__hint"
									>Bulan yang lebih pendek memakai hari terakhirnya.</span
								>{/if}
						</div>
					{/if}
					<div class="bf-field">
						<label for="ai-time">Jam (WIB)</label>
						<select id="ai-time" name="time" bind:value={time}>
							{#each AI_TIMES as t (t)}<option value={t}>{t}</option>{/each}
						</select>
					</div>
				</div>
			{:else}
				<input type="hidden" name="time" value={time} />
			{/if}
			{#if frequency !== 'weekly'}<input type="hidden" name="weekday" value={weekday} />{/if}
			{#if frequency !== 'monthly'}<input type="hidden" name="monthDay" value={monthDay} />{/if}

			<dl
				class="grid gap-x-6 gap-y-2 rounded-control bg-tint-2 px-4 py-3 text-small sm:grid-cols-2"
			>
				<div>
					<dt class="font-bold text-ink-2">Jadwal</dt>
					<dd class="text-ink">{scheduleText(draft)}</dd>
				</div>
				<div>
					<dt class="font-bold text-ink-2">Berikutnya</dt>
					<dd class="text-ink">{next ? when(next) : 'Tidak terjadwal (hanya manual)'}</dd>
				</div>
				<div>
					<dt class="font-bold text-ink-2">Terakhir berjalan</dt>
					<dd class="text-ink">
						{data.settings.lastRunAt ? when(new Date(data.settings.lastRunAt)) : 'Belum pernah'}
					</dd>
				</div>
				<div>
					<dt class="font-bold text-ink-2">Saran terbuka berlaku</dt>
					<dd class="text-ink">{suggestionTtlDays(frequency)} hari, lalu kedaluwarsa</dd>
				</div>
			</dl>
		</section>

		<button type="submit" class="bf-btn bf-btn--primary w-fit" disabled={saving}>
			{saving ? 'Menyimpan…' : 'Simpan'}
		</button>
	</form>
</main>
