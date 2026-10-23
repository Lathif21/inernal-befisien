<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';

	type Props = {
		open: boolean;
		title: string;
		description?: string;
		children: Snippet;
		/** Sticky bottom bar, usually Batal + one primary button */
		footer?: Snippet;
		/** Called when the person closes it (X, Esc, overlay) */
		onclose?: () => void;
	};

	let { open = $bindable(), title, description, children, footer, onclose }: Props = $props();
</script>

<!-- Right-side panel for create / edit forms and record details. Full width on phones. -->
<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) onclose?.();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-navy/40" />
		<Dialog.Content
			class="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-modal sm:w-[480px] sm:rounded-l-panel"
		>
			<div class="flex items-start gap-3 border-b border-line px-5 py-4">
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

			<div class="flex-1 overflow-y-auto px-5 py-5">
				{@render children()}
			</div>

			{#if footer}
				<div class="flex justify-end gap-2 border-t border-line px-5 py-3">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
