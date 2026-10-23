<script lang="ts">
	import type { Snippet } from 'svelte';

	type ControlAttrs = {
		id: string;
		name: string;
		'aria-invalid': 'true' | undefined;
		'aria-describedby': string | undefined;
		'aria-required': 'true' | undefined;
	};

	type Props = {
		label: string;
		name: string;
		/** Superforms field errors */
		errors?: string[];
		hint?: string;
		required?: boolean;
		/** Render the input / select / textarea and spread `attrs` onto it */
		children: Snippet<[ControlAttrs]>;
	};

	let { label, name, errors, hint, required = false, children }: Props = $props();

	const id = $derived(`field-${name}`);
	const error = $derived(errors?.[0]);
	const describedBy = $derived(
		[error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined
	);
</script>

<!-- bf-field: label above the control, inline error below (docs/design-system/components/bundle.css) -->
<div class="bf-field">
	<label for={id}>
		{label}{#if required}<span class="text-danger" aria-hidden="true"> *</span>{/if}
	</label>
	{@render children({
		id,
		name,
		'aria-invalid': error ? 'true' : undefined,
		'aria-describedby': describedBy,
		'aria-required': required ? 'true' : undefined
	})}
	{#if hint && !error}<span id="{id}-hint" class="bf-field__hint">{hint}</span>{/if}
	{#if error}<span id="{id}-error" class="bf-field__error">{error}</span>{/if}
</div>
