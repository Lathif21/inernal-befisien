<script lang="ts">
	import { resolve } from '$app/paths';

	let { current }: { current: 'transaksi' | 'laba-rugi' } = $props();
</script>

<!-- Keuangan sections: Transaksi (/finance) and Laba Rugi (/finance/laba-rugi, P2-08) -->
<nav class="bf-seg w-fit max-w-full overflow-x-auto" aria-label="Bagian keuangan">
	<a
		href={resolve('finance')}
		aria-current={current === 'transaksi' ? 'page' : undefined}
		data-sveltekit-reset="false">Transaksi</a
	>
	<a
		href={resolve('finance/laba-rugi')}
		aria-current={current === 'laba-rugi' ? 'page' : undefined}
		data-sveltekit-reset="false">Laba Rugi</a
	>
</nav>
