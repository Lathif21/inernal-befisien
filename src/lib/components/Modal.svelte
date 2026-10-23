<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';

	type Props = {
		open: boolean;
		title: string;
		description?: string;
		/** Coloured header band, e.g. "bg-success-bg" for Deal menang */
		tone?: string;
		children: Snippet;
		footer?: Snippet;
		/** Called when the person dismisses it (X, Esc, overlay) */
		onclose?: () => void;
	};

	let { open = $bindable(), title, description, tone, children, footer, onclose }: Props = $props();
</script>

<!-- Centred dialog for decisions (Deal menang, Batal reason). Drawers are for create / edit forms. -->
<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) onclose?.();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-navy/40" />
		<Dialog.Content
			class="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel bg-surface shadow-modal"
		>
			<div class={['flex items-start gap-3 px-6 pt-5 pb-4', tone]}>
				<div class="min-w-0 flex-1">
					<Dialog.Title class="text-section-title">{title}</Dialog.Title>
					{#if description}
						<Dialog.Description class="mt-1 text-small text-ink-2">{description}</Dialog.Description
						>
					{/if}
				</div>
				<Dialog.Close class="bf-icon-btn shrink-0" aria-label="Tutup">
					<X size={18} strokeWidth={1.75} />
				</Dialog.Close>
			</div>
			<div class="flex-1 overflow-y-auto px-6 py-4">
				{@render children()}
			</div>
			{#if footer}
				<div class="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-3">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
