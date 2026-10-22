<script lang="ts">
	import { Toaster } from 'svelte-sonner';
</script>

<!-- Mounted once in the root layout. Call `toast` from '#lib/toast.ts'. -->
<Toaster
	position="bottom-right"
	closeButton
	toastOptions={{
		unstyled: true,
		classes: {
			toast:
				'flex w-[356px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-kanban border border-line bg-surface p-4 font-sans text-body text-ink shadow-raised',
			title: 'font-bold',
			description: 'text-small text-ink-2',
			success: 'border-l-4 border-l-success-fill [&_[data-icon]]:text-success-fill',
			error: 'border-l-4 border-l-danger-fill [&_[data-icon]]:text-danger-fill',
			warning: 'border-l-4 border-l-warning-fill [&_[data-icon]]:text-warning',
			info: 'border-l-4 border-l-accent [&_[data-icon]]:text-accent',
			actionButton: 'bf-btn bf-btn--primary bf-btn--sm ml-auto',
			cancelButton: 'bf-btn bf-btn--secondary bf-btn--sm',
			closeButton: 'bf-icon-btn order-last ml-auto size-7! shrink-0'
		}
	}}
/>
