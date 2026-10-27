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

export type Signature = {
	/** The person who writes; left out when it is the company name */
	name: string | null;
	company: string;
	phone: string | null;
	email: string;
	/** "befisien.com", linked as https:// */
	website: string | null;
	city: string | null;
};

/** The signature as plain text, after the usual "--" line */
export function signatureText(s: Signature) {
	const contact = [s.phone, s.email, s.website].filter(Boolean).join(' · ');
	return ['--', s.name, s.company, contact, s.city].filter(Boolean).join('\n');
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
// values of navy / ink-2 / accent / line from docs/design-system/tokens.json
const INK = '#0B1840';
const INK_2 = '#3E4C75';
const ACCENT = '#1F5BEA';
const LINE = '#DCE4F5';

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

/** Plain text as simple HTML (paragraphs, line breaks, quotes) */
export function textToHtml(text: string) {
	return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK}">${blocks(text)}</div>`;
}

function signatureHtml(s: Signature) {
	const link = (href: string, label: string) =>
		`<a href="${escapeHtml(href)}" style="color:${ACCENT};text-decoration:none">${escapeHtml(label)}</a>`;
	const contact = [
		s.phone && escapeHtml(s.phone),
		link(`mailto:${s.email}`, s.email),
		s.website && link(`https://${s.website}`, s.website)
	].filter(Boolean);
	const row = (html: string, style: string) => `<div style="${style}">${html}</div>`;
	return (
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 16px;border-collapse:collapse"><tr>` +
		`<td style="border-left:3px solid ${ACCENT};padding:2px 0 2px 12px;font-family:Arial,Helvetica,sans-serif">` +
		(s.name ? row(escapeHtml(s.name), `font-size:14px;font-weight:bold;color:${INK}`) : '') +
		row(escapeHtml(s.company), `font-size:13px;font-weight:bold;color:${ACCENT}`) +
		row(contact.join(' &middot; '), `font-size:12px;color:${INK_2};padding-top:4px`) +
		(s.city ? row(escapeHtml(s.city), `font-size:12px;color:${INK_2}`) : '') +
		`</td></tr></table>`
	);
}

/**
 * The email as sent: the message, the signature, and for a reply the earlier message quoted
 * under it (like Gmail). `text` is also what the thread stores and shows.
 */
export function composeEmail(input: { body: string; signature: Signature; parent?: ReplyParent }) {
	const body = input.body.trim();
	const parts = [body, signatureText(input.signature)];
	if (input.parent) parts.push(`${quoteIntro(input.parent)}\n${quoteLines(input.parent.text)}`);
	const text = parts.join('\n\n');

	const quote = input.parent
		? `<div style="color:${INK_2};font-size:13px;margin:0 0 8px">${escapeHtml(quoteIntro(input.parent))}</div>${blocks(quoteLines(input.parent.text))}`
		: '';
	const html =
		`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK};max-width:640px">` +
		blocks(body) +
		signatureHtml(input.signature) +
		quote +
		`</div>`;
	return { text, html };
}
