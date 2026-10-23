<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import InvoiceEditor from '#lib/components/invoices/InvoiceEditor.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<Topbar title="Invoice baru" />

<main class="page-body gap-5!">
	<a
		href={resolve('invoices')}
		class="inline-flex min-h-(--size-touch) w-fit items-center gap-1.5 text-small font-bold text-accent-ink no-underline"
	>
		<ArrowLeft size={15} strokeWidth={2.2} />
		Semua invoice
	</a>
	<p class="-mt-3 text-small text-ink-2">
		Nomor invoice dibuat otomatis saat disimpan, dari bulan tanggal invoice.
	</p>
	<InvoiceEditor
		form={data.form}
		clients={data.targets.clients}
		projects={data.targets.projects}
		editable
	/>
</main>
