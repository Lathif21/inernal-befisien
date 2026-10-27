// Download link from an email (P3-08 big files): /f/<token>. Public: the recipient has no account;
// the 32-character token is the key. A working link redirects to a fresh presigned GET (an hour),
// so the bucket itself is never public and the link can live longer than a presigned URL can.
import { db } from '#lib/server/db/index.ts';
import { fileStorage } from '#lib/server/email-config.ts';
import { fileByToken } from '#lib/server/services/email-files.ts';
import type { RequestHandler } from './$types';

const page = (status: number, title: string, text: string) =>
	new Response(
		`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Befisien</title></head>` +
			`<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#EEF3FF;font-family:Arial,Helvetica,sans-serif;color:#0B1840">` +
			`<main style="max-width:420px;margin:24px;padding:28px;background:#FFFFFF;border-radius:14px;text-align:center">` +
			`<p style="margin:0 0 4px;font-size:13px;font-weight:bold;letter-spacing:2px;color:#1F5BEA">BEFISIEN</p>` +
			`<h1 style="margin:8px 0 12px;font-size:20px">${title}</h1><p style="margin:0;font-size:14px;line-height:1.6;color:#3E4C75">${text}</p>` +
			`</main></body></html>`,
		{
			status,
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store',
				'x-robots-tag': 'noindex'
			}
		}
	);

export const GET: RequestHandler = async ({ params }) => {
	if (!/^[A-Za-z0-9_-]{20,64}$/.test(params.token))
		return page(404, 'Link tidak ditemukan', 'Periksa lagi link di email Anda.');
	const { file, expired } = await fileByToken(db, params.token);
	if (expired)
		return page(
			410,
			'Link sudah kedaluwarsa',
			'File ini sudah tidak tersedia. Balas email kami bila Anda masih membutuhkannya.'
		);
	if (!file || !fileStorage)
		return page(404, 'Link tidak ditemukan', 'Periksa lagi link di email Anda.');
	const url = await fileStorage.downloadUrl(file.key, file.filename);
	return new Response(null, {
		status: 303,
		headers: { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
	});
};
