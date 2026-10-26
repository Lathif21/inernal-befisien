import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisClient, sumopodClient } from './client';

const reply = (content: string) =>
	vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					model: 'm',
					choices: [{ message: { content }, finish_reason: 'stop' }],
					usage: { prompt_tokens: 1, completion_tokens: 2 }
				})
			)
	);
const ask = (allowText?: boolean) =>
	sumopodClient({ apiKey: 'k', model: 'm' })({
		system: 's',
		user: 'u',
		schema: {},
		schemaName: 'x',
		allowText
	});

describe('sumopodClient answers', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('reads JSON, also inside a ```json fence', async () => {
		vi.stubGlobal('fetch', reply('```json\n{"summary":"ok"}\n```'));
		expect((await ask()).json).toEqual({ summary: 'ok' });
	});

	it('keeps prose only when the caller allows text', async () => {
		vi.stubGlobal('fetch', reply('Profil & kebutuhan:\n- energi'));
		expect((await ask(true)).json).toBe('Profil & kebutuhan:\n- energi');
		await expect(ask()).rejects.toThrow('AI answer is not JSON');
	});
});

describe('analysisClient', () => {
	afterEach(() => vi.unstubAllGlobals());
	const req = { system: 's', user: 'u', schema: {}, schemaName: 'x' };

	it('goes to 9router with its model when the key is set', async () => {
		const fetch = reply('{"ok":true}');
		vi.stubGlobal('fetch', fetch);
		const fallback = vi.fn();
		await analysisClient({ apiKey: 'nr' }, fallback)(req);
		expect(fallback).not.toHaveBeenCalled();
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('http://localhost:20128/v1/chat/completions');
		expect(JSON.parse(String(init.body)).model).toBe('cc/claude-opus-5-5');
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer nr');
	});

	it('uses the fallback without a key', () => {
		const fallback = vi.fn();
		expect(analysisClient({ apiKey: '' }, fallback)).toBe(fallback);
	});
});
