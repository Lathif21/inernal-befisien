<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Topbar from '#lib/components/layout/Topbar.svelte';
</script>

<!-- Placeholder until P1-09 -->
<Topbar title="Keuangan" />

<main class="page-body">
	<EmptyState
		illustration="dashboard"
		message="Pemasukan, pengeluaran, dan laba per klien akan tampil di sini."
	/>
</main>
