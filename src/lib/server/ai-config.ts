// The app's AI client, wired to its env vars. Trigger.dev tasks build their own from process.env.
import { AI_BASE_URL, AI_MODEL, SUMOPOD_API_KEY } from '$app/env/private';
import { DEFAULT_AI_MODEL, sumopodClient, type AiComplete } from '#lib/server/ai/client.ts';

export const aiEnabled = () => !!SUMOPOD_API_KEY;

export function aiComplete(): AiComplete {
	return sumopodClient({
		apiKey: SUMOPOD_API_KEY ?? '',
		model: AI_MODEL || DEFAULT_AI_MODEL,
		baseUrl: AI_BASE_URL
	});
}
