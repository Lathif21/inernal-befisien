<script lang="ts">
	type Props = {
		name: string;
		tone?: 'accent' | 'dark';
		/** Diameter in px (26–30 per tokens.json size-avatar) */
		size?: number;
	};

	let { name, tone = 'accent', size = 28 }: Props = $props();

	const initials = $derived(
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

<span
	class={['bf-avatar', tone === 'dark' && 'bf-avatar--dark']}
	style:width="{size}px"
	style:height="{size}px"
	title={name}
	aria-hidden="true">{initials}</span
>
