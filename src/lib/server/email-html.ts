// The compose editor's HTML on the way out: cleaned to what the editor can write, and pictures turned
// into inline attachments (cid:). Relative imports only: services/email.ts uses it.
import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { BODY_STYLES } from '../email';

const IMAGE_DATA = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/]+=*)$/i;

const styled = (tagName: string, attribs: sanitizeHtml.Attributes) => ({
	tagName,
	attribs: { ...attribs, style: BODY_STYLES[tagName] }
});

/**
 * Only the tags and attributes the editor writes; every style is replaced by BODY_STYLES. Links
 * are http(s), mailto or tel; pictures are base64 PNG / JPEG / GIF / WebP or https.
 */
export function cleanEmailHtml(html: string) {
	return sanitizeHtml(html, {
		allowedTags: [
			'p',
			'br',
			'strong',
			'b',
			'em',
			'i',
			'u',
			's',
			'a',
			'ul',
			'ol',
			'li',
			'blockquote',
			'h2',
			'h3',
			'pre',
			'code',
			'hr',
			'img'
		],
		allowedAttributes: {
			a: ['href', 'style'],
			img: ['src', 'alt', 'style'],
			...Object.fromEntries(
				Object.keys(BODY_STYLES)
					.filter((t) => t !== 'a' && t !== 'img')
					.map((t) => [t, ['style']])
			)
		},
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: { img: ['data', 'https'] },
		allowProtocolRelative: false,
		transformTags: Object.fromEntries(Object.keys(BODY_STYLES).map((t) => [t, styled])),
		exclusiveFilter: (frame) => {
			if (frame.tag !== 'img') return false;
			const src = frame.attribs.src ?? '';
			return !IMAGE_DATA.test(src) && !/^https:\/\//i.test(src);
		}
	}).trim();
}

/** True when the cleaned body has no words and no picture */
export const isEmptyBody = (html: string) =>
	!/<img\b/i.test(html) && !sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim();

export type InlineImage = {
	/** `<img src="cid:…">` in the sent HTML; under 128 characters (Resend) */
	contentId: string;
	filename: string;
	contentType: string;
	/** Base64, as Resend takes it */
	content: string;
	size: number;
};

const EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp'
};

/**
 * Pictures pasted into the message (base64 `data:` sources) as inline attachments: the returned HTML
 * points at them with `cid:`, the stored copy keeps the `data:` version so the thread still shows
 * them after Resend's retention. The same picture twice is attached once.
 */
export function embedImages(html: string, makeId: () => string = () => randomUUID().slice(0, 8)) {
	const images = new Map<string, InlineImage>();
	const out = html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (match, pre, src, post) => {
		const hit = IMAGE_DATA.exec(src);
		if (!hit) return match;
		let image = images.get(src);
		if (!image) {
			const n = images.size + 1;
			const [, contentType, content] = hit;
			const type = contentType.toLowerCase();
			const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
			image = {
				contentId: `gambar-${n}-${makeId()}@befisien`,
				filename: `gambar-${n}.${EXT[type]}`,
				contentType: type,
				content,
				size: (content.length * 3) / 4 - padding
			};
			images.set(src, image);
		}
		return `${pre}cid:${image.contentId}${post}`;
	});
	return { html: out, images: [...images.values()] };
}
