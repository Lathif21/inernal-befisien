// Big files in emails (P3-08): which uploaded files go as attachments and which as download links,
// and the "File besar" block the email carries for the links. Pure and client-safe: the drawer
// shows the same plan the server sends.
import { fileSize } from './email';
import { dateID } from './format';

/** One uploaded file: what the bucket accepts (the browser uploads it straight there) */
export const EMAIL_FILE_MAX = 200 * 1024 * 1024;

/**
 * Attachments together stay under this: Resend takes 40 MB per email after base64 (×4/3), and
 * Gmail / Outlook refuse more than 20-25 MB. Anything over it goes as a link.
 */
export const EMAIL_ATTACH_BUDGET = 25 * 1024 * 1024;

/** A download link works this long; the cleanup task deletes the file after */
export const EMAIL_FILE_LINK_DAYS = 30;

/**
 * Files in the order they were added: each is attached while it still fits in `budget` (what is
 * left after pictures and forwarded files), the rest become links. A small file after a big one
 * can still be attached.
 */
export function planFiles<T extends { size: number }>(files: T[], budget: number) {
	const attach: T[] = [];
	const link: T[] = [];
	let left = budget;
	for (const f of files) {
		if (f.size <= left) {
			attach.push(f);
			left -= f.size;
		} else link.push(f);
	}
	return { attach, link };
}

export type FileLink = { filename: string; size: number; url: string };

const until = (expiresAt: Date) => dateID(expiresAt);

/** The links as plain text, for the text part of the email */
export function fileLinksText(links: FileLink[], expiresAt: Date) {
	if (!links.length) return '';
	return [
		`File besar (unduh sebelum ${until(expiresAt)}):`,
		...links.map((l) => `- ${l.filename} (${fileSize(l.size)}): ${l.url}`)
	].join('\n');
}

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline colours (email clients ignore CSS variables): navy / ink-3 / accent / tint-2 / line
const INK = '#0B1840';
const INK_3 = '#5E6A8E';
const ACCENT = '#1F5BEA';
const TINT_2 = '#EEF3FF';
const LINE = '#DCE4F5';

/** The links as a block of rows (name, size, Unduh), under the message */
export function fileLinksHtml(links: FileLink[], expiresAt: Date) {
	if (!links.length) return '';
	const rows = links
		.map(
			(l) =>
				`<tr><td style="padding:8px 12px;border-top:1px solid ${LINE};font-size:13px;color:${INK}"><b>${escapeHtml(l.filename)}</b>` +
				`<span style="color:${INK_3}"> &nbsp;${escapeHtml(fileSize(l.size))}</span></td>` +
				`<td align="right" style="padding:8px 12px;border-top:1px solid ${LINE};white-space:nowrap">` +
				`<a href="${escapeHtml(l.url)}" style="display:inline-block;padding:6px 14px;border-radius:6px;background:${ACCENT};color:#FFFFFF;font-size:12px;font-weight:bold;text-decoration:none">Unduh</a></td></tr>`
		)
		.join('');
	return (
		`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;width:100%;max-width:520px;border-collapse:collapse;background:${TINT_2};border:1px solid ${LINE};border-radius:8px;font-family:Arial,Helvetica,sans-serif">` +
		`<tr><td colspan="2" style="padding:10px 12px;font-size:12px;color:${INK_3}">File besar, unduh sebelum <b style="color:${INK}">${escapeHtml(until(expiresAt))}</b></td></tr>` +
		rows +
		`</table>`
	);
}
