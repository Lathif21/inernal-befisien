<script lang="ts">
	import type { Snippet } from 'svelte';

	export type Illustration =
		'agent' | 'automation' | 'cms' | 'dashboard' | 'integration' | 'hero-base';

	type Props = {
		/** One 3D render from static/illustrations (docs/06-DESIGN-SYSTEM.md → Illustrations) */
		illustration: Illustration;
		/** One sentence */
		message: string;
		/** One button */
		action?: Snippet;
	};

	let { illustration, message, action }: Props = $props();
</script>

<div
	class="flex flex-col items-center gap-4 rounded-card bg-surface px-6 py-10 text-center sm:py-14"
>
	<img
		src="/illustrations/{illustration}.webp"
		alt=""
		width="220"
		height="180"
		loading="lazy"
		class="h-auto w-44 sm:w-56"
	/>
	<p class="max-w-md text-body font-semibold text-ink-2">{message}</p>
	{#if action}{@render action()}{/if}
</div>

<style>
	img {
		/* The renders have a baked-in grey ground; fade it out radially like befisien.com does */
		mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 64%, transparent 94%);
	}
</style>
