// Forwarding an email (P3-08): the "Fwd:" subject and the forwarded message under the new text,
// like Gmail's "---------- Pesan yang diteruskan ----------". Pure and client-safe.
import { textToHtml } from './email';
import { dateID } from './format';

/** The message being forwarded, as stored in the inbox */
export type ForwardedMessage = {
	/** "Budi Santoso <budi@x.co.id>" */
	from: string;
	to: string[];
	cc: string[];
	sentAt: Date;
	subject: string;
	text: string;
	html: string | null;
};

/** "Fwd: …" once; a reply prefix stays inside ("Fwd: Re: Penawaran") */
export function forwardSubject(subject: string) {
	const s = subject.trim();
	return /^(fwd?|tr|wg|teruskan)\s*:/i.test(s) ? s : `Fwd: ${s || '(tanpa subjek)'}`;
}

const SEPARATOR = '---------- Pesan yang diteruskan ----------';

/** Dari / Tanggal / Subjek / Kepada / Cc of the forwarded message */
export function forwardHeader(m: ForwardedMessage): [string, string][] {
	const rows: [string, string][] = [
		['Dari', m.from],
		['Tanggal', `${dateID(m.sentAt)} ${dateID(m.sentAt, 'time')} WIB`],
		['Subjek', m.subject || '(tanpa subjek)'],
		['Kepada', m.to.join(', ') || '–']
	];
	if (m.cc.length) rows.push(['Cc', m.cc.join(', ')]);
	return rows;
}

/** The forwarded message as plain text, for the text part of the new email */
export function forwardText(m: ForwardedMessage) {
	const header = forwardHeader(m).map(([k, v]) => `${k}: ${v}`);
	return [SEPARATOR, ...header, '', m.text.trim()].join('\n');
}

/**
 * The content of an email's HTML without the document around it: what is inside <body>, with
 * scripts, frames, forms and the <head> (title, meta, styles for the whole page) removed.
 */
export function htmlBody(html: string) {
	const inner = /<body\b[^>]*>([\s\S]*?)(<\/body>|$)/i.exec(html)?.[1] ?? html;
	return inner
		.replace(/<(head|script|noscript|iframe|object|embed|form|title)\b[\s\S]*?<\/\1>/gi, '')
		.replace(/<\/?(html|head|body|meta|link|base|script|iframe|object|embed|form)\b[^>]*>/gi, '')
		.trim();
}

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline colours (email clients ignore CSS variables): ink-2 and line from tokens.json
const INK_2 = '#3E4C75';
const LINE = '#DCE4F5';

/** The forwarded message as HTML: the header block, then its own HTML (or its text as paragraphs) */
export function forwardHtml(m: ForwardedMessage) {
	const header = forwardHeader(m)
		.map(([k, v]) => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</div>`)
		.join('');
	const original = m.html ? htmlBody(m.html) : textToHtml(m.text);
	return (
		`<div style="margin:16px 0 0;padding-top:12px;border-top:1px solid ${LINE}">` +
		`<div style="font-size:13px;line-height:1.6;color:${INK_2};margin:0 0 12px">` +
		`<div>${SEPARATOR}</div>${header}</div>` +
		`<div>${original}</div></div>`
	);
}
