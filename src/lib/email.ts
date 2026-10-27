// Email helpers for the inbox (P3-08): addresses, threading headers, text from HTML, reply quoting.
// Pure and client-safe; services/email.ts and the inbox pages use them.
import { dateID } from './format';

export type Address = { name: string | null; email: string };

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export const isEmail = (value: string) => EMAIL.test(value);

/** `"Budi" <Budi@X.co.id>`, `Budi <budi@x.co.id>` or `budi@x.co.id` → name + lower-case address */
export function parseAddress(raw: string): Address | null {
	const value = raw.trim();
	const angle = /^(.*?)<([^<>]+)>\s*$/.exec(value);
	const email = (angle ? angle[2] : value).trim().toLowerCase();
	if (!isEmail(email)) return null;
	const name = angle?.[1]
		.trim()
		.replace(/^"(.*)"$/, '$1')
		.trim();
	return { name: name || null, email };
}

/** "Budi Santoso <budi@x.co.id>"; quotes a name that has a comma or other special characters */
export function formatAddress(a: Address) {
	if (!a.name) return a.email;
	const name = /[",;:<>()@[\]]/.test(a.name) ? `"${a.name.replace(/"/g, '')}"` : a.name;
	return `${name} <${a.email}>`;
}

/** Name if known, else the address */
export const addressLabel = (a: Address) => a.name || a.email;

/** A To / Cc field typed by a person: commas, semicolons or new lines between addresses */
export function parseAddressList(input: string): { addresses: Address[]; invalid: string[] } {
	const addresses: Address[] = [];
	const invalid: string[] = [];
	const seen = new Set<string>();
	// Split on separators outside quotes and angle brackets
	for (const part of input.match(/(?:"[^"]*"|<[^>]*>|[^,;\n])+/g) ?? []) {
		if (!part.trim()) continue;
		const a = parseAddress(part);
		if (!a) invalid.push(part.trim());
		else if (!seen.has(a.email)) {
			seen.add(a.email);
			addresses.push(a);
		}
	}
	return { addresses, invalid };
}

export type MailHeaders = Record<string, string | string[] | undefined>;

/** A header by name, ignoring case; repeated headers are joined */
export function headerValue(headers: MailHeaders | null | undefined, name: string) {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers))
		if (key.toLowerCase() === wanted) return Array.isArray(value) ? value.join(' ') : value;
	return undefined;
}

/** Every `<…>` Message-ID in a header (In-Reply-To, References) */
export function parseMessageIds(value: string | null | undefined): string[] {
	return value?.match(/<[^<>\s]+>/g) ?? [];
}

/** Newsletters, mailing lists and auto-replies: kept in the inbox, but no Telegram alert */
export function isBulk(headers: MailHeaders | null | undefined) {
	if (headerValue(headers, 'list-unsubscribe') || headerValue(headers, 'list-id')) return true;
	const precedence = headerValue(headers, 'precedence')?.trim().toLowerCase();
	if (precedence && ['bulk', 'list', 'junk'].includes(precedence)) return true;
	const auto = headerValue(headers, 'auto-submitted')?.trim().toLowerCase();
	return !!auto && auto !== 'no';
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

/** Readable text from an HTML body, for snippets, Telegram and the AI context */
export function htmlToText(html: string) {
	return html
		.replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
		.replace(/<li[^>]*>/gi, '• ')
		.replace(/<[^>]+>/g, '')
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
			if (e[0] === '#')
				return String.fromCodePoint(
					e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
				);
			return ENTITIES[e.toLowerCase()] ?? m;
		})
		.replace(/[ \t\u00a0]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// "On Mon, 27 Oct 2026, Budi wrote:" / "Pada … menulis:" starts the quoted part of a reply
const QUOTE_INTRO = /^(on|pada)\s.+(wrote|menulis):\s*$/i;

/** The new part of a message (quoted lines and the quote intro dropped) */
export function newText(text: string) {
	const lines: string[] = [];
	for (const line of text.split('\n')) {
		if (QUOTE_INTRO.test(line.trim())) break;
		if (line.trim().startsWith('>')) continue;
		lines.push(line);
	}
	return lines.join('\n').trim();
}

/** The first words of a message, one line */
export function snippetOf(text: string, max = 200) {
	const flat = (newText(text) || text).replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** "Re: …" once, whatever the earlier messages called it */
export function replySubject(subject: string) {
	const s = subject.trim();
	return /^(re|balas|aw|sv)\s*:/i.test(s) ? s : `Re: ${s || '(tanpa subjek)'}`;
}

/** References for a reply: the parent's references plus the parent itself (RFC 5322 §3.6.4) */
export function replyReferences(parent: { messageId: string | null; references: string[] }) {
	const ids = [...parent.references, ...(parent.messageId ? [parent.messageId] : [])];
	return [...new Set(ids)];
}

/** The look of the company in every email (befisien.com): logo, tagline, services, profiles */
export type EmailBrand = {
	/** Public URL of the logo mark PNG (an SVG is not shown by Gmail or Outlook) */
	logoUrl: string | null;
	/** The name in every email (signature line and wordmark): "Befisien", without "Technologies" */
	name: string;
	/** "BEFISIEN", next to the mark */
	wordmark: string;
	tagline: string;
	services: string[];
	links: { label: string; url: string }[];
};

export type Signature = {
	/** The person who writes; left out when it is the company name */
	name: string | null;
	company: string;
	phone: string | null;
	email: string;
	/** "befisien.com", linked as https:// */
	website: string | null;
	city: string | null;
	brand: EmailBrand;
};

/** The signature as plain text, after the usual "--" line */
export function signatureText(s: Signature) {
	const contact = [s.phone, s.email, s.website].filter(Boolean).join(' · ');
	const links = s.brand.links.map((l) => `${l.label}: ${l.url}`).join(' · ');
	return ['--', s.name, s.company, contact, s.city, links].filter(Boolean).join('\n');
}

export type ReplyParent = { from: string; sentAt: Date; text: string };

const quoteIntro = (parent: ReplyParent) =>
	`Pada ${dateID(parent.sentAt)} ${dateID(parent.sentAt, 'time')} WIB, ${parent.from} menulis:`;

const quoteLines = (text: string) =>
	text
		.split('\n')
		.map((l) => `> ${l}`.trimEnd())
		.join('\n');

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Email clients ignore stylesheets and CSS variables, so the email carries inline colours: the
// values of navy / ink-2 / ink-3 / accent / sky / tint-2 / line from docs/design-system/tokens.json
const INK = '#0B1840';
const INK_2 = '#3E4C75';
const INK_3 = '#5E6A8E';
const ACCENT = '#1F5BEA';
const SKY = '#9FD4FF';
const TINT_2 = '#EEF3FF';
const LINE = '#DCE4F5';
const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";

/** Plain text as HTML blocks: paragraphs, line breaks, `>` lines as a blockquote */
function blocks(text: string) {
	const out: string[] = [];
	let quote: string[] = [];
	let para: string[] = [];
	const flushPara = () => {
		if (para.length)
			out.push(`<p style="margin:0 0 12px">${para.map(escapeHtml).join('<br>')}</p>`);
		para = [];
	};
	const flushQuote = () => {
		if (quote.length)
			out.push(
				`<blockquote style="margin:0 0 12px;border-left:2px solid ${LINE};padding-left:12px;color:${INK_2}">${quote.map(escapeHtml).join('<br>')}</blockquote>`
			);
		quote = [];
	};
	for (const line of text.split('\n')) {
		if (line.startsWith('>')) {
			flushPara();
			quote.push(line.replace(/^> ?/, ''));
		} else if (!line.trim()) {
			flushPara();
			flushQuote();
		} else {
			flushQuote();
			para.push(line);
		}
	}
	flushPara();
	flushQuote();
	return out.join('');
}

/**
 * Inline styles for the tags the compose editor writes (cleanEmailHtml sets them, replacing
 * whatever style came in), so the message looks the same in Gmail and Outlook.
 */
export const BODY_STYLES: Record<string, string> = {
	p: 'margin:0 0 12px',
	h2: `margin:16px 0 8px;font-size:18px;line-height:1.3;color:${INK}`,
	h3: `margin:16px 0 8px;font-size:16px;line-height:1.3;color:${INK}`,
	ul: 'margin:0 0 12px;padding-left:24px',
	ol: 'margin:0 0 12px;padding-left:24px',
	li: 'margin:0 0 4px',
	blockquote: `margin:0 0 12px;border-left:2px solid ${LINE};padding-left:12px;color:${INK_2}`,
	a: `color:${ACCENT}`,
	img: 'display:block;max-width:100%;height:auto;margin:0 0 12px;border:0',
	pre: `margin:0 0 12px;padding:10px 12px;background:${TINT_2};border-radius:6px;white-space:pre-wrap`,
	code: 'font-family:Consolas,Menlo,monospace;font-size:13px',
	hr: `border:0;border-top:1px solid ${LINE};margin:16px 0`
};

/**
 * Files and pictures together, measured as the request carries them (pictures as base64 inside the
 * body). Vercel refuses requests over 4.5 MB; on the VPS this can grow together with adapter-node's
 * BODY_SIZE_LIMIT.
 */
export const EMAIL_UPLOAD_LIMIT = 4 * 1024 * 1024;
export const EMAIL_MAX_FILES = 10;

/** What one email weighs on the way up: the body (pictures included) plus the files */
export const uploadSize = (bodyHtml: string, files: { size: number }[]) =>
	bodyHtml.length + files.reduce((sum, f) => sum + f.size, 0);

// Program files: Resend (and Gmail) refuse them, so the drawer says so before sending
const BLOCKED_FILE =
	/\.(adp|app|bat|cmd|com|cpl|exe|hta|inf|ins|jar|js|jse|lnk|msc|msi|msp|pif|ps1|reg|scr|sct|shb|shs|sys|vb|vbe|vbs|ws|wsc|wsf|wsh)$/i;

export const isBlockedFile = (filename: string) => BLOCKED_FILE.test(filename.trim());

/** Resend keeps sent and received emails, attachments included, for this many days */
export const RESEND_RETENTION_DAYS = 30;

export const attachmentExpired = (sentAt: Date | string, now = new Date()) =>
	now.getTime() - new Date(sentAt).getTime() > RESEND_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** "820 B", "35 KB", "1,4 MB" */
export function fileSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Plain text as simple HTML (paragraphs, line breaks, quotes) */
export function textToHtml(text: string) {
	return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK}">${blocks(text)}</div>`;
}

/**
 * The signature card, in tables with inline styles so Gmail and Outlook keep the layout: the logo
 * and wordmark beside the sender and contacts, then a navy band with the tagline, the services and
 * the company's profiles. With images blocked the wordmark is still text.
 */
export function signatureHtml(s: Signature) {
	const e = escapeHtml;
	const table = (style: string, rows: string) =>
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${style}">${rows}</table>`;
	const link = (href: string, label: string, color = ACCENT) =>
		`<a href="${e(href)}" style="color:${color};text-decoration:none">${e(label)}</a>`;
	const contactRow = (label: string, value: string) =>
		`<tr><td style="padding:1px 10px 1px 0;font-size:10px;font-weight:bold;letter-spacing:1px;color:${INK_3};vertical-align:top">${label}</td>` +
		`<td style="padding:1px 0;font-size:12px;color:${INK_2};white-space:nowrap">${value}</td></tr>`;

	const logo =
		(s.brand.logoUrl
			? `<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${e(s.brand.logoUrl)}" width="30" height="40" alt="" style="display:block;border:0;width:30px;height:40px"></td>`
			: '') +
		`<td style="vertical-align:middle;white-space:nowrap">` +
		`<div style="font-size:17px;line-height:18px;font-weight:800;letter-spacing:1px;color:${INK}">${e(s.brand.wordmark)}</div></td>`;

	const person =
		(s.name
			? `<div style="font-size:15px;line-height:20px;font-weight:bold;color:${INK}">${e(s.name)}</div>`
			: '') +
		`<div style="font-size:12px;line-height:18px;font-weight:bold;color:${ACCENT};padding-bottom:6px">${e(s.company)}</div>` +
		table(
			'',
			(s.phone
				? contactRow('TELP', link(`tel:${s.phone.replace(/[^\d+]/g, '')}`, s.phone, INK_2))
				: '') +
				contactRow('EMAIL', link(`mailto:${s.email}`, s.email)) +
				(s.website ? contactRow('WEB', link(`https://${s.website}`, s.website)) : '') +
				(s.city ? contactRow('KOTA', e(s.city)) : '')
		);

	const band =
		`<tr><td colspan="3" bgcolor="${INK}" style="background:${INK};padding:10px 16px;border-radius:0 0 10px 10px">` +
		`<div style="font-size:12px;line-height:17px;font-weight:bold;color:#FFFFFF">${e(s.brand.tagline)}</div>` +
		(s.brand.services.length
			? `<div style="font-size:11px;line-height:16px;color:${SKY};padding-top:3px">${s.brand.services.map(e).join(' &nbsp;&middot;&nbsp; ')}</div>`
			: '') +
		(s.brand.links.length
			? `<div style="font-size:11px;line-height:16px;padding-top:6px">${s.brand.links.map((l) => link(l.url, l.label, '#FFFFFF')).join(`<span style="color:${SKY}"> &nbsp;|&nbsp; </span>`)}</div>`
			: '') +
		`</td></tr>`;

	return (
		`<div style="margin:24px 0 16px;font-family:${FONT}">` +
		table(
			`width:100%;max-width:520px;background:${TINT_2};border:1px solid ${LINE};border-radius:10px`,
			`<tr><td style="padding:16px 16px 14px;vertical-align:middle;white-space:nowrap">${table('', `<tr>${logo}</tr>`)}</td>` +
				`<td style="padding:16px 0;vertical-align:middle"><div style="width:2px;height:64px;background:${ACCENT};font-size:0;line-height:0">&nbsp;</div></td>` +
				`<td style="padding:14px 16px;vertical-align:middle;font-family:${FONT}">${person}</td></tr>` +
				band
		) +
		`</div>`
	);
}

/**
 * The email as sent: the message, the signature, and for a reply the earlier message quoted
 * under it (like Gmail). `body` is the editor's HTML after cleanEmailHtml; `text` (the plain-text
 * part, also what the thread stores) is made from it.
 */
export function composeEmail(input: { body: string; signature: Signature; parent?: ReplyParent }) {
	const body = input.body.trim();
	const bodyText = htmlToText(body.replace(/<img\b[^>]*>/gi, '<p>[gambar]</p>'));
	const parts = [bodyText, signatureText(input.signature)];
	if (input.parent) parts.push(`${quoteIntro(input.parent)}\n${quoteLines(input.parent.text)}`);
	const text = parts.join('\n\n');

	const quote = input.parent
		? `<div style="color:${INK_2};font-size:13px;margin:0 0 8px">${escapeHtml(quoteIntro(input.parent))}</div>${blocks(quoteLines(input.parent.text))}`
		: '';
	const html =
		`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK};max-width:640px">` +
		body +
		signatureHtml(input.signature) +
		quote +
		`</div>`;
	return { text, html };
}
