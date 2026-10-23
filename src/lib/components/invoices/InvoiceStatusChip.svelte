<script lang="ts">
	import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '#lib/constants.ts';

	let { status }: { status: InvoiceStatus } = $props();

	// Meaning is in the label; colour only supports it (docs/design-system/components/Chip)
	const TONE: Record<InvoiceStatus, string> = {
		draft: 'bf-chip--planned',
		sent: 'bf-chip--accent',
		partial: 'bf-chip--warning',
		paid: 'bf-chip--success',
		overdue: 'bf-chip--danger',
		void: ''
	};
</script>

<span class={['bf-chip', TONE[status], status === 'void' && 'line-through']}
	>{INVOICE_STATUS_LABELS[status]}</span
>
