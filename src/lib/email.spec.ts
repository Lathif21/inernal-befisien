import { describe, expect, it } from 'vitest';
import {
	formatAddress,
	headerValue,
	htmlToText,
	isBulk,
	newText,
	parseAddress,
	parseAddressList,
	parseMessageIds,
	quoteReply,
	replyReferences,
	replySubject,
	snippetOf,
	textToHtml
} from './email';

describe('addresses', () => {
	it('parses names, quotes and bare addresses, lower-casing the address', () => {
		expect(parseAddress('"Budi Santoso" <Budi@Maju.co.id>')).toEqual({
			name: 'Budi Santoso',
			email: 'budi@maju.co.id'
		});
		expect(parseAddress('Ani <ani@x.id>')).toEqual({ name: 'Ani', email: 'ani@x.id' });
		expect(parseAddress(' ani@x.id ')).toEqual({ name: null, email: 'ani@x.id' });
		expect(parseAddress('bukan email')).toBeNull();
	});

	it('quotes a display name with a comma', () => {
		expect(formatAddress({ name: 'Santoso, Budi', email: 'b@x.id' })).toBe(
			'"Santoso, Budi" <b@x.id>'
		);
		expect(formatAddress({ name: null, email: 'b@x.id' })).toBe('b@x.id');
	});

	it('splits a typed list, keeps quoted commas, drops duplicates and reports bad entries', () => {
		const r = parseAddressList('"Santoso, Budi" <b@x.id>; ani@x.id,\nB@x.id, salah');
		expect(r.addresses.map((a) => a.email)).toEqual(['b@x.id', 'ani@x.id']);
		expect(r.invalid).toEqual(['salah']);
	});
});

describe('headers', () => {
	it('reads headers ignoring case', () => {
		expect(headerValue({ 'In-Reply-To': '<a@x>' }, 'in-reply-to')).toBe('<a@x>');
		expect(headerValue({ references: ['<a@x>', '<b@x>'] }, 'References')).toBe('<a@x> <b@x>');
	});

	it('finds every message id', () => {
		expect(parseMessageIds('<a@x>\n <b@y>')).toEqual(['<a@x>', '<b@y>']);
		expect(parseMessageIds(undefined)).toEqual([]);
	});

	it('marks newsletters and auto-replies as bulk', () => {
		expect(isBulk({ 'List-Unsubscribe': '<mailto:x>' })).toBe(true);
		expect(isBulk({ precedence: 'Bulk' })).toBe(true);
		expect(isBulk({ 'auto-submitted': 'auto-replied' })).toBe(true);
		expect(isBulk({ 'auto-submitted': 'no', subject: 'Halo' })).toBe(false);
	});
});

describe('bodies', () => {
	it('turns HTML into readable text', () => {
		const html =
			'<html><head><style>p{}</style></head><body><p>Halo&nbsp;tim,</p><p>Harga: Rp 5.000 &amp; PPN</p><ul><li>Satu</li></ul></body></html>';
		expect(htmlToText(html)).toBe('Halo tim,\nHarga: Rp 5.000 & PPN\n• Satu');
	});

	it('keeps only the new part of a reply for the snippet', () => {
		const text = 'Siap, Kamis bisa.\n\nOn Mon, 27 Oct 2026, Ani wrote:\n> Bisa meeting?';
		expect(newText(text)).toBe('Siap, Kamis bisa.');
		expect(snippetOf(text)).toBe('Siap, Kamis bisa.');
		expect(snippetOf('a'.repeat(300), 10)).toBe(`${'a'.repeat(9)}…`);
	});

	it('prefixes Re: once', () => {
		expect(replySubject('Penawaran')).toBe('Re: Penawaran');
		expect(replySubject('RE: Penawaran')).toBe('RE: Penawaran');
		expect(replySubject('')).toBe('Re: (tanpa subjek)');
	});

	it('builds references from the parent', () => {
		expect(replyReferences({ messageId: '<c@x>', references: ['<a@x>', '<b@x>'] })).toEqual([
			'<a@x>',
			'<b@x>',
			'<c@x>'
		]);
	});

	it('quotes the parent under the reply and renders it as HTML', () => {
		const text = quoteReply('Terima kasih.', {
			from: 'Ani <ani@x.id>',
			sentAt: new Date('2026-10-27T03:00:00Z'),
			text: 'Bisa <meeting>?'
		});
		expect(text).toContain('Terima kasih.\n\nPada 27 Okt 2026');
		expect(text).toContain('Ani <ani@x.id> menulis:\n> Bisa <meeting>?');
		const html = textToHtml(text);
		expect(html).toContain('<p>Terima kasih.</p>');
		expect(html).toContain('<blockquote');
		expect(html).toContain('Bisa &lt;meeting&gt;?');
	});
});
