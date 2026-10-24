import { afterEach, describe, expect, it, vi } from 'vitest';
import { sumopodClient } from './client';

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
