<script lang="ts">
	import { untrack } from 'svelte';
	import { superForm } from 'sveltekit-superforms';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Field from '#lib/components/form/Field.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import { toast } from '#lib/toast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const { form, errors, enhance, submitting } = superForm(
		untrack(() => data.form),
		{
			resetForm: false,
			onUpdated({ form }) {
				if (form.message?.type === 'success') toast.success(form.message.text);
			}
		}
	);
</script>

<Topbar title="Profil perusahaan" />

<main class="page-body gap-5!">
	<a
		href={resolve('settings')}
		class="inline-flex min-h-(--size-touch) w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Pengaturan
	</a>

	<p class="text-small text-ink-2">
		Dicetak di setiap PDF invoice: kop surat, rekening pembayaran, dan tanda tangan. Kolom yang
		kosong tidak ditampilkan.
	</p>
	{#if data.isExample}
		<p class="rounded-control bg-warning-bg px-4 py-3 text-small font-semibold text-ink">
			Isian di bawah masih contoh (NPWP dan rekening bank tidak nyata). Periksa lalu simpan.
		</p>
	{/if}

	<form method="post" action="?/save" use:enhance class="flex flex-col gap-5">
		<div class="grid gap-5 *:min-w-0 lg:grid-cols-2">
			<section
				class="flex flex-col gap-4 rounded-card bg-surface p-5 lg:row-span-2"
				aria-labelledby="company-title"
			>
				<h2 id="company-title" class="text-section-title">Perusahaan</h2>
				<Field label="Nama perusahaan" name="name" errors={$errors.name} required>
					{#snippet children(attrs)}
						<input {...attrs} bind:value={$form.name} maxlength="120" autocomplete="organization" />
					{/snippet}
				</Field>
				<Field label="Alamat" name="address" errors={$errors.address}>
					{#snippet children(attrs)}
						<textarea {...attrs} bind:value={$form.address} rows="3" maxlength="300"></textarea>
					{/snippet}
				</Field>
				<Field
					label="Kota"
					name="city"
					errors={$errors.city}
					hint="Untuk baris tanda tangan, mis. Surabaya, 24 Oktober 2026"
				>
					{#snippet children(attrs)}
						<input {...attrs} bind:value={$form.city} maxlength="60" />
					{/snippet}
				</Field>
				<div class="grid gap-4 *:min-w-0 sm:grid-cols-2">
					<Field label="Telepon" name="phone" errors={$errors.phone}>
						{#snippet children(attrs)}
							<input
								{...attrs}
								bind:value={$form.phone}
								type="tel"
								inputmode="tel"
								maxlength="24"
							/>
						{/snippet}
					</Field>
					<Field label="Email" name="email" errors={$errors.email}>
						{#snippet children(attrs)}
							<input {...attrs} bind:value={$form.email} type="email" maxlength="200" />
						{/snippet}
					</Field>
				</div>
				<Field label="NPWP" name="npwp" errors={$errors.npwp} hint="15 atau 16 digit">
					{#snippet children(attrs)}
						<input {...attrs} bind:value={$form.npwp} inputmode="numeric" maxlength="24" />
					{/snippet}
				</Field>
			</section>

			<section class="flex flex-col gap-4 rounded-card bg-surface p-5" aria-labelledby="bank-title">
				<h2 id="bank-title" class="text-section-title">Rekening pembayaran</h2>
				<Field label="Nama bank" name="bankName" errors={$errors.bankName}>
					{#snippet children(attrs)}
						<input {...attrs} bind:value={$form.bankName} maxlength="80" placeholder="mis. BCA" />
					{/snippet}
				</Field>
				<Field label="Nomor rekening" name="bankAccountNumber" errors={$errors.bankAccountNumber}>
					{#snippet children(attrs)}
						<input
							{...attrs}
							bind:value={$form.bankAccountNumber}
							inputmode="numeric"
							maxlength="40"
						/>
					{/snippet}
				</Field>
				<Field label="Atas nama" name="bankAccountName" errors={$errors.bankAccountName}>
					{#snippet children(attrs)}
						<input {...attrs} bind:value={$form.bankAccountName} maxlength="120" />
					{/snippet}
				</Field>
			</section>

			<section
				class="flex flex-col gap-4 rounded-card bg-surface p-5"
				aria-labelledby="signer-title"
			>
				<h2 id="signer-title" class="text-section-title">Penanda tangan</h2>
				<div class="grid gap-4 *:min-w-0 sm:grid-cols-2">
					<Field label="Nama" name="signerName" errors={$errors.signerName}>
						{#snippet children(attrs)}
							<input {...attrs} bind:value={$form.signerName} maxlength="80" />
						{/snippet}
					</Field>
					<Field label="Jabatan" name="signerTitle" errors={$errors.signerTitle}>
						{#snippet children(attrs)}
							<input {...attrs} bind:value={$form.signerTitle} maxlength="80" />
						{/snippet}
					</Field>
				</div>
			</section>
		</div>

		<button type="submit" class="bf-btn bf-btn--primary w-fit" disabled={$submitting}>
			{$submitting ? 'Menyimpan…' : 'Simpan'}
		</button>
	</form>
</main>
