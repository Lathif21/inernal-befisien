<script lang="ts">
	import { newText } from '#lib/email.ts';

	type Props = {
		html: string | null;
		text: string | null;
	};

	let { html, text }: Props = $props();

	let showImages = $state(false);

	// Remote images can track when an email is opened, so they wait for "Tampilkan gambar"
	const hasRemote = $derived(
		!!html && /(<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:)/i.test(html)
	);

	/**
	 * The email's own HTML in a sandboxed frame: no scripts, no forms, links open in a new tab, and a
	 * CSP that blocks every remote request unless images are allowed. Same-origin only so the frame
	 * can be sized to its content (safe because scripts never run inside it).
	 */
	const doc = $derived.by(() => {
		const remote = showImages ? ' https: http:' : '';
		const csp = `default-src 'none'; img-src data: cid:${remote}; style-src 'unsafe-inline'${remote}; font-src data:${remote}`;
		return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="color-scheme" content="light"><base target="_blank"><style>html{background:white;color:black}body{margin:0;padding:4px 2px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body>${html ?? ''}</body></html>`;
	});

	function fit(frame: HTMLIFrameElement) {
		const inner = frame.contentDocument;
		if (!inner) return;
		const resize = () => (frame.style.height = `${inner.documentElement.scrollHeight + 4}px`);
		resize();
		new ResizeObserver(resize).observe(inner.body);
	}

	const plain = $derived((text ?? '').trim());
	const fresh = $derived(newText(plain));
</script>

{#if html}
	{#if hasRemote}
		<p class="mb-2 flex flex-wrap items-center gap-2 text-small text-ink-2">
			{#if showImages}
				Gambar dari internet ditampilkan.
			{:else}
				Gambar dari internet disembunyikan untuk privasi.
				<button
					type="button"
					class="font-bold text-accent-ink hover:underline"
					onclick={() => (showImages = true)}>Tampilkan gambar</button
				>
			{/if}
		</p>
	{/if}
	<!-- Email HTML is designed for a white page, also in dark mode -->
	<div class="overflow-hidden rounded-control bg-surface ring-1 ring-line">
		<iframe
			title="Isi email"
			srcdoc={doc}
			sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
			referrerpolicy="no-referrer"
			class="block min-h-24 w-full"
			onload={(e) => fit(e.currentTarget as HTMLIFrameElement)}
		></iframe>
	</div>
{:else if plain}
	<p class="text-body break-words whitespace-pre-wrap text-ink">{fresh || plain}</p>
	{#if fresh && fresh !== plain}
		<details class="mt-2">
			<summary class="cursor-pointer text-small font-bold text-ink-2">Tampilkan kutipan</summary>
			<p class="mt-2 text-small break-words whitespace-pre-wrap text-ink-2">
				{plain.slice(plain.indexOf(fresh) + fresh.length).trim()}
			</p>
		</details>
	{/if}
{:else}
	<p class="text-body text-ink-3 italic">(Email tanpa isi)</p>
{/if}
