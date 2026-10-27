import { describe, expect, it } from 'vitest';
import {
	forwardHeader,
	forwardHtml,
	forwardSubject,
	forwardText,
	htmlBody,
	type ForwardedMessage
} from './email-forward';

const original: ForwardedMessage = {
	from: 'Budi Santoso <budi@majujaya.co.id>',
	to: ['info@befisien.com'],
	cc: ['Ani <ani@majujaya.co.id>'],
	sentAt: new Date('2026-10-27T03:00:00Z'),
	subject: 'Penawaran dashboard',
	text: 'Halo Befisien,\n\nKami ingin penawaran.',
	html: null
};

describe('forward', () => {
	it('prefixes Fwd: once and keeps a reply prefix inside', () => {
		expect(forwardSubject('Penawaran')).toBe('Fwd: Penawaran');
		expect(forwardSubject('Re: Penawaran')).toBe('Fwd: Re: Penawaran');
		expect(forwardSubject('FW: Penawaran')).toBe('FW: Penawaran');
		expect(forwardSubject('')).toBe('Fwd: (tanpa subjek)');
	});

	it('lists sender, date in WIB, subject and recipients; Cc only when there is one', () => {
		expect(forwardHeader(original)).toEqual([
			['Dari', 'Budi Santoso <budi@majujaya.co.id>'],
			['Tanggal', '27 Okt 2026 10:00 WIB'],
			['Subjek', 'Penawaran dashboard'],
			['Kepada', 'info@befisien.com'],
			['Cc', 'Ani <ani@majujaya.co.id>']
		]);
		expect(forwardHeader({ ...original, cc: [] }).map(([k]) => k)).not.toContain('Cc');
	});

	it('writes the plain-text block like Gmail', () => {
		expect(forwardText(original).split('\n').slice(0, 3)).toEqual([
			'---------- Pesan yang diteruskan ----------',
			'Dari: Budi Santoso <budi@majujaya.co.id>',
			'Tanggal: 27 Okt 2026 10:00 WIB'
		]);
		expect(forwardText(original)).toContain('\n\nHalo Befisien,\n\nKami ingin penawaran.');
	});

	it('keeps the body of an HTML email and drops the page around it and anything active', () => {
		const html =
			'<html><head><title>x</title><style>p{}</style></head><body class="b"><p>Halo</p><script>alert(1)</script><iframe src="x"></iframe><form><input></form></body></html>';
		expect(htmlBody(html)).toBe('<p>Halo</p>');
		expect(htmlBody('<p>tanpa body</p>')).toBe('<p>tanpa body</p>');
	});

	it('escapes the header and falls back to the text when there is no HTML', () => {
		const html = forwardHtml({ ...original, from: 'X <x@y.id>' });
		expect(html).toContain('<b>Dari:</b> X &lt;x@y.id&gt;');
		expect(html).toContain('Kami ingin penawaran.');
		expect(forwardHtml({ ...original, html: '<body><p>Asli</p></body>' })).toContain(
			'<div><p>Asli</p></div>'
		);
	});
});
