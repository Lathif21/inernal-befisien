import type { SubmitFunction } from '$app/forms';
import { toast } from './toast';

/**
 * `use:enhance` handler for simple actions that return `{ done }` or `fail(400, { error })`.
 * Stays on the current URL (SvelteKit 3 otherwise navigates to the action URL and drops the
 * query string), reloads the page data, and only then shows the toast, so the message never
 * appears next to stale data.
 */
export function refreshThenToast(
	hooks: { start?: () => void; end?: (ok: boolean) => void } = {}
): SubmitFunction {
	return () => {
		hooks.start?.();
		return async ({ result, update }) => {
			await update({ navigate: false });
			hooks.end?.(result.type === 'success');
			if (result.type === 'success') toast.success(String(result.data?.done));
			if (result.type === 'failure') toast.error(String(result.data?.error));
		};
	};
}
