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

/** The reply text with the earlier message quoted under it */
export function quoteReply(body: string, parent: { from: string; sentAt: Date; text: string }) {
	const quoted = parent.text
		.split('\n')
		.map((l) => `> ${l}`.trimEnd())
		.join('\n');
	const at = `${dateID(parent.sentAt)} ${dateID(parent.sentAt, 'time')} WIB`;
	return `${body.trim()}\n\nPada ${at}, ${parent.from} menulis:\n${quoted}`;
}

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text as simple HTML: paragraphs, line breaks, `>` lines as a blockquote */
export function textToHtml(text: string) {
	const blocks: string[] = [];
	let quote: string[] = [];
	let para: string[] = [];
	const flushPara = () => {
		if (para.length) blocks.push(`<p>${para.map(escapeHtml).join('<br>')}</p>`);
		para = [];
	};
	const flushQuote = () => {
		if (quote.length)
			blocks.push(
				`<blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555">${quote.map(escapeHtml).join('<br>')}</blockquote>`
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
	return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${blocks.join('')}</div>`;
}
