<script lang="ts">
	import { Editor } from '@tiptap/core';
	import Image from '@tiptap/extension-image';
	import StarterKit from '@tiptap/starter-kit';
	import { onMount } from 'svelte';
	import Bold from '@lucide/svelte/icons/bold';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import Italic from '@lucide/svelte/icons/italic';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import TextQuote from '@lucide/svelte/icons/text-quote';
	import { EMAIL_IMAGE_TYPES, emailImage, isEmailImage } from '#lib/email-image.ts';
	import { toast } from '#lib/toast.ts';

	type Props = {
		id: string;
		/** The visible label's id (a contenteditable cannot be the target of `<label for>`) */
		labelledby: string;
		describedby?: string;
		invalid?: boolean;
		/** Files dropped or pasted that are not pictures; the drawer attaches them */
		onfiles?: (files: File[]) => void;
		/** After every change, for the size counter */
		onchange?: () => void;
	};

	let { id, labelledby, describedby, invalid = false, onfiles, onchange }: Props = $props();

	let element: HTMLDivElement;
	let imageInput: HTMLInputElement;
	let editor = $state.raw<Editor | null>(null);
	// Bumped on every transaction, so the toolbar shows what is active at the cursor
	let tick = $state(0);

	/** The message as HTML; '' when nothing was written */
	export function getHTML() {
		return editor && !editor.isEmpty ? editor.getHTML() : '';
	}

	/** About what getHTML() weighs, without serialising the pictures on every key press */
	export function weight() {
		let size = 0;
		editor?.state.doc.descendants((node) => {
			if (node.type.name === 'image') size += String(node.attrs.src ?? '').length;
			else if (node.isText) size += node.text?.length ?? 0;
		});
		return size;
	}

	export function focus() {
		editor?.commands.focus();
	}

	async function insertImages(files: File[], pos?: number) {
		for (const file of files) {
			try {
				const src = await emailImage(file);
				const image = { type: 'image', attrs: { src, alt: file.name } };
				const chain = editor?.chain().focus();
				(pos === undefined
					? chain?.insertContent(image)
					: chain?.insertContentAt(pos, image)
				)?.run();
			} catch (e) {
				toast.error(e instanceof Error ? e.message : `${file.name} gagal dimuat.`);
			}
		}
	}

	/** Pictures go into the text, anything else to the attachments */
	function take(list: FileList | null | undefined, pos?: number) {
		const files = [...(list ?? [])];
		if (!files.length) return false;
		const images = files.filter(isEmailImage);
		const others = files.filter((f) => !isEmailImage(f));
		if (images.length) insertImages(images, pos);
		if (others.length) onfiles?.(others);
		return true;
	}

	const attributes = () => ({
		id,
		role: 'textbox',
		'aria-multiline': 'true',
		'aria-labelledby': labelledby,
		...(describedby ? { 'aria-describedby': describedby } : {}),
		...(invalid ? { 'aria-invalid': 'true' } : {}),
		class: 'email-editor__content'
	});

	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3] },
					link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
				}),
				Image.configure({ allowBase64: true })
			],
			editorProps: {
				attributes: attributes(),
				handlePaste: (_view, event) => {
					if (!take(event.clipboardData?.files)) return false;
					event.preventDefault();
					return true;
				},
				handleDrop: (view, event, _slice, moved) => {
					if (moved) return false;
					const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
					if (!take(event.dataTransfer?.files, pos)) return false;
					event.preventDefault();
					return true;
				}
			},
			onTransaction: () => tick++,
			onUpdate: () => onchange?.()
		});
		return () => editor?.destroy();
	});

	// An error from the server marks the field invalid after the editor was made
	$effect(() => {
		const attrs = attributes();
		if (editor && !editor.isDestroyed)
			editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: attrs } });
	});

	const isActive = (name: string) => {
		void tick;
		return editor?.isActive(name) ?? false;
	};

	const tools = [
		{
			name: 'bold',
			label: 'Tebal',
			icon: Bold,
			run: () => editor?.chain().focus().toggleBold().run()
		},
		{
			name: 'italic',
			label: 'Miring',
			icon: Italic,
			run: () => editor?.chain().focus().toggleItalic().run()
		},
		{
			name: 'bulletList',
			label: 'Daftar berbutir',
			icon: List,
			run: () => editor?.chain().focus().toggleBulletList().run()
		},
		{
			name: 'orderedList',
			label: 'Daftar bernomor',
			icon: ListOrdered,
			run: () => editor?.chain().focus().toggleOrderedList().run()
		},
		{
			name: 'blockquote',
			label: 'Kutipan',
			icon: TextQuote,
			run: () => editor?.chain().focus().toggleBlockquote().run()
		}
	];
</script>

<div class="email-editor" class:email-editor--invalid={invalid}>
	<div
		class="flex flex-wrap gap-1 border-b border-line p-1.5"
		role="group"
		aria-label="Format pesan"
	>
		{#each tools as tool (tool.name)}
			<button
				type="button"
				class="email-editor__tool"
				aria-label={tool.label}
				title={tool.label}
				aria-pressed={isActive(tool.name)}
				onclick={tool.run}
			>
				<tool.icon size={16} strokeWidth={2} />
			</button>
		{/each}
		<span class="mx-1 w-px self-stretch bg-line" aria-hidden="true"></span>
		<button
			type="button"
			class="email-editor__tool"
			aria-label="Sisipkan gambar"
			title="Sisipkan gambar"
			onclick={() => imageInput.click()}
		>
			<ImagePlus size={16} strokeWidth={2} />
		</button>
		<input
			bind:this={imageInput}
			type="file"
			accept={EMAIL_IMAGE_TYPES.join(',')}
			multiple
			hidden
			onchange={(e) => {
				insertImages([...(e.currentTarget.files ?? [])]);
				e.currentTarget.value = '';
			}}
		/>
	</div>
	<div bind:this={element}></div>
</div>

<style>
	.email-editor {
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		font-size: 14.5px;
		font-weight: 500;
		color: var(--color-ink);
	}
	.email-editor:focus-within {
		outline: 3px solid var(--color-accent);
		outline-offset: 2px;
	}
	.email-editor--invalid {
		border-color: var(--color-danger-fill);
	}
	.email-editor__tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		color: var(--color-ink-2);
		cursor: pointer;
	}
	.email-editor__tool:hover {
		background: var(--color-tint-2);
	}
	.email-editor__tool[aria-pressed='true'] {
		background: var(--color-tint-2);
		color: var(--color-accent-ink);
	}
	.email-editor :global(.email-editor__content) {
		min-height: 220px;
		max-height: 55vh;
		overflow-y: auto;
		padding: 10px 14px;
		line-height: 1.6;
		outline: none;
		overflow-wrap: anywhere;
	}
	.email-editor :global(.email-editor__content > * + *) {
		margin-top: 10px;
	}
	.email-editor :global(.email-editor__content ul) {
		list-style: disc;
		padding-left: 24px;
	}
	.email-editor :global(.email-editor__content ol) {
		list-style: decimal;
		padding-left: 24px;
	}
	.email-editor :global(.email-editor__content blockquote) {
		border-left: 2px solid var(--color-line);
		padding-left: 12px;
		color: var(--color-ink-2);
	}
	.email-editor :global(.email-editor__content a) {
		color: var(--color-accent-ink);
		text-decoration: underline;
	}
	.email-editor :global(.email-editor__content h2) {
		font-size: 18px;
		font-weight: 700;
	}
	.email-editor :global(.email-editor__content h3) {
		font-size: 16px;
		font-weight: 700;
	}
	.email-editor :global(.email-editor__content img) {
		display: block;
		max-width: 100%;
		height: auto;
		border-radius: 6px;
	}
	.email-editor :global(.email-editor__content img.ProseMirror-selectednode) {
		outline: 3px solid var(--color-accent);
	}
</style>
