// The app's AI client, wired to its env vars. Trigger.dev tasks build their own from process.env.
import {
	AI_BASE_URL,
	AI_MODEL,
	NINEROUTER_API_KEY,
	NINEROUTER_BASE_URL,
	NINEROUTER_MODEL,
	SUMOPOD_API_KEY
} from '$app/env/private';
import {
	analysisClient,
	DEFAULT_AI_MODEL,
	sumopodClient,
	type AiComplete
} from '#lib/server/ai/client.ts';

export const aiEnabled = () => !!SUMOPOD_API_KEY;

export function aiComplete(): AiComplete {
	return sumopodClient({
		apiKey: SUMOPOD_API_KEY ?? '',
		model: AI_MODEL || DEFAULT_AI_MODEL,
		baseUrl: AI_BASE_URL
	});
}

/** Analysis a person asks for ("Minta saran AI"): 9router when set, otherwise `aiComplete()` */
export function aiAnalyze(): AiComplete {
	return analysisClient(
		{ apiKey: NINEROUTER_API_KEY, model: NINEROUTER_MODEL, baseUrl: NINEROUTER_BASE_URL },
		aiComplete()
	);
}
