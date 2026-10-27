import { describe, expect, it } from 'vitest';
import { EMAIL_ATTACH_BUDGET, fileLinksHtml, fileLinksText, planFiles } from './email-files';

const MB = 1024 * 1024;
const f = (name: string, mb: number) => ({ name, size: mb * MB });

describe('planFiles', () => {
	it('attaches while the files fit and links the rest, in the order they were added', () => {
		const plan = planFiles([f('a', 10), f('big', 180), f('b', 12), f('c', 5)], EMAIL_ATTACH_BUDGET);
		expect(plan.attach.map((x) => x.name)).toEqual(['a', 'b']);
		expect(plan.link.map((x) => x.name)).toEqual(['big', 'c']);
	});

	it('links everything when pictures and forwarded files used the budget', () => {
		expect(planFiles([f('a', 1)], 0).link).toHaveLength(1);
		expect(planFiles([f('a', 25)], EMAIL_ATTACH_BUDGET).attach).toHaveLength(1);
	});
});

describe('file links', () => {
	const links = [{ filename: 'Video <demo>.mp4', size: 180 * MB, url: 'https://crm.id/f/abc' }];
	const expires = new Date('2026-11-26T03:00:00Z');

	it('lists name, size and link with the last day, in text', () => {
		expect(fileLinksText(links, expires)).toBe(
			'File besar (unduh sebelum 26 Nov 2026):\n- Video <demo>.mp4 (180,0 MB): https://crm.id/f/abc'
		);
		expect(fileLinksText([], expires)).toBe('');
	});

	it('escapes the name in HTML and links the Unduh button', () => {
		const html = fileLinksHtml(links, expires);
		expect(html).toContain('Video &lt;demo&gt;.mp4');
		expect(html).toContain('href="https://crm.id/f/abc"');
		expect(html).toContain('26 Nov 2026');
		expect(fileLinksHtml([], expires)).toBe('');
	});
});
