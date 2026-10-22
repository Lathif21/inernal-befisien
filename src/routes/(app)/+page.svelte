<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
</script>

<!-- Placeholder until P1-10. Tiles show [XX]: no invented numbers. -->
<Topbar title="Dashboard" />

<main class="page-body">
	<section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Ringkasan">
		<StatTile label="Pemasukan" value={null} />
		<StatTile label="Pengeluaran" value={null} />
		<StatTile label="Laba bersih" value={null} variant="dark" />
		<StatTile label="Nilai pipeline aktif" value={null} />
	</section>

	<EmptyState
		illustration="dashboard"
		message="Ringkasan keuangan dan pipeline akan tampil di sini setelah data klien dan transaksi masuk."
	/>
</main>
