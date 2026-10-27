import { describe, expect, it } from 'vitest';
import { cleanEmailHtml, embedImages, isEmptyBody } from './email-html';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('cleanEmailHtml', () => {
	it('keeps what the editor writes and gives it the email styles', () => {
		const html = cleanEmailHtml(
			'<p style="color:red">Halo <strong>Budi</strong>, <a href="https://befisien.com" target="_blank" rel="noopener">lihat</a></p><ul><li>satu</li></ul>'
		);
		expect(html).toContain('<p style="margin:0 0 12px">Halo <strong>Budi</strong>');
		expect(html).toContain('<a href="https://befisien.com" style="color:#1F5BEA">lihat</a>');
		expect(html).toContain('<ul style="margin:0 0 12px;padding-left:24px"><li style=');
		expect(html).not.toContain('color:red');
		expect(html).not.toContain('target=');
	});

	it('drops scripts, handlers, javascript: links and pictures it cannot send', () => {
		const html = cleanEmailHtml(
			`<p onclick="x()">a<script>alert(1)</script></p><a href="javascript:alert(1)">b</a><img src="${PNG}" alt="logo" onerror="x()"><img src="data:text/html;base64,PGgxPg=="><img src="http://x.id/a.png"><iframe src="https://x.id"></iframe>`
		);
		expect(html).not.toMatch(/script|onclick|onerror|javascript|iframe|text\/html|http:\/\//);
		expect(html).toContain(`<img src="${PNG}" alt="logo"`);
		expect(html.match(/<img/g)).toHaveLength(1);
	});

	it('knows an empty message', () => {
		expect(isEmptyBody(cleanEmailHtml('<p></p><p> </p>'))).toBe(true);
		expect(isEmptyBody(cleanEmailHtml(`<p><img src="${PNG}"></p>`))).toBe(false);
		expect(isEmptyBody(cleanEmailHtml('<p>Halo</p>'))).toBe(false);
	});
});

describe('embedImages', () => {
	it('turns base64 pictures into cid attachments, once per picture', () => {
		const html = `<p>a</p><img src="${PNG}" alt=""><img src="https://befisien.com/x.png"><img src="${PNG}">`;
		const out = embedImages(html, () => 'abc');
		expect(out.images).toEqual([
			{
				contentId: 'gambar-1-abc@befisien',
				filename: 'gambar-1.png',
				contentType: 'image/png',
				content: 'iVBORw0KGgo=',
				size: 8
			}
		]);
		expect(out.html).toBe(
			'<p>a</p><img src="cid:gambar-1-abc@befisien" alt=""><img src="https://befisien.com/x.png"><img src="cid:gambar-1-abc@befisien">'
		);
	});
});
