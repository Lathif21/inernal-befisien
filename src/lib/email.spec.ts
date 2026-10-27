import { describe, expect, it } from 'vitest';
import {
	composeEmail,
	formatAddress,
	headerValue,
	htmlToText,
	isBulk,
	newText,
	parseAddress,
	parseAddressList,
	parseMessageIds,
	replyReferences,
	replySubject,
	signatureHtml,
	signatureText,
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

	const signature = {
		name: 'Lathif Dewantoro',
		company: 'Befisien Technologies',
		phone: '+62 822-3456-7461',
		email: 'info@befisien.com',
		website: 'befisien.com',
		city: 'Surabaya',
		brand: {
			logoUrl: 'https://crm.example.id/email/befisien-mark.png',
			wordmark: ['BEFISIEN', 'TECHNOLOGIES'] as [string, string],
			tagline: 'Tingkatkan Efisiensi dan Akselerasi Bisnis Anda',
			services: ['AI Agent', 'Dashboard & Aplikasi'],
			links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/befisien' }]
		}
	};

	it('builds the signature card with the logo, contacts, tagline, services and profiles', () => {
		const html = signatureHtml(signature);
		expect(html).toContain('src="https://crm.example.id/email/befisien-mark.png"');
		expect(html).toContain('>BEFISIEN</div>');
		expect(html).toContain('href="tel:+6282234567461"');
		expect(html).toContain('href="mailto:info@befisien.com"');
		expect(html).toContain('Dashboard &amp; Aplikasi');
		expect(html).toContain('href="https://www.linkedin.com/in/befisien"');
		// Without a public app URL the logo is left out; the wordmark stays as text
		const noLogo = signatureHtml({ ...signature, brand: { ...signature.brand, logoUrl: null } });
		expect(noLogo).not.toContain('<img');
		expect(noLogo).toContain('TECHNOLOGIES');
	});

	it('writes the signature as plain text, skipping what is unknown', () => {
		expect(signatureText(signature).split('\n')).toEqual([
			'--',
			'Lathif Dewantoro',
			'Befisien Technologies',
			'+62 822-3456-7461 · info@befisien.com · befisien.com',
			'Surabaya',
			'LinkedIn: https://www.linkedin.com/in/befisien'
		]);
		expect(
			signatureText({
				...signature,
				name: null,
				phone: null,
				website: null,
				city: null,
				brand: { ...signature.brand, links: [] }
			}).split('\n')
		).toEqual(['--', 'Befisien Technologies', 'info@befisien.com']);
	});

	it('puts the message, then the signature, then the quoted parent', () => {
		const { text, html } = composeEmail({
			body: '  Terima kasih.  ',
			signature,
			parent: {
				from: 'Ani <ani@x.id>',
				sentAt: new Date('2026-10-27T03:00:00Z'),
				text: 'Bisa <meeting>?'
			}
		});
		expect(text).toBe(
			`Terima kasih.

${signatureText(signature)}

Pada 27 Okt 2026 10:00 WIB, Ani <ani@x.id> menulis:
> Bisa <meeting>?`
		);
		expect(html.indexOf('Terima kasih.')).toBeLessThan(html.indexOf('Befisien Technologies'));
		expect(html.indexOf('Befisien Technologies')).toBeLessThan(html.indexOf('<blockquote'));
		expect(html).toContain('href="mailto:info@befisien.com"');
		expect(html).toContain('href="https://befisien.com"');
		expect(html).toContain('Bisa &lt;meeting&gt;?');
		expect(html).toContain('Ani &lt;ani@x.id&gt; menulis:');
	});

	it('sends a new email without a quote, and escapes the signature', () => {
		const { text, html } = composeEmail({
			body: 'Halo',
			signature: { ...signature, company: 'PT <A&B>' }
		});
		expect(text).not.toContain('menulis:');
		expect(html).toContain('PT &lt;A&amp;B&gt;');
		expect(textToHtml('Halo\n> kutipan')).toContain('<blockquote');
	});
});
