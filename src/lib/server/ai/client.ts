// LLM access for AI suggestions (P2-01). Sumopod is an OpenAI-compatible gateway
// (https://ai.sumopod.com/v1); `response_format: json_schema` is passed through to the model.
// Relative imports only and config passed in: the Trigger.dev tasks use this too.

export type AiConfig = {
	apiKey: string;
	/** e.g. claude-opus-5-5 (default), claude-sonnet-5-5, claude-haiku-5-5 */
	model: string;
	baseUrl?: string;
};

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export const DEFAULT_AI_BASE_URL = 'https://ai.sumopod.com/v1';

export type AiRequest = {
	system: string;
	user: string;
	/** JSON Schema the answer must follow (strict) */
	schema: Record<string, unknown>;
	schemaName: string;
	maxTokens?: number;
};

export type AiResult = {
	/** Parsed JSON; still to be validated by the caller (Zod) */
	json: unknown;
	model: string;
	usage: { input: number; output: number } | null;
};

/** The one thing the services need from an LLM; tests pass a fake */
export type AiComplete = (req: AiRequest) => Promise<AiResult>;

export function sumopodClient(config: AiConfig): AiComplete {
	const baseUrl = (config.baseUrl || DEFAULT_AI_BASE_URL).replace(/\/$/, '');
	return async (req) => {
		if (!config.apiKey) throw new Error('SUMOPOD_API_KEY is not set');
		const res = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${config.apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: config.model,
				// Reasoning models spend part of this on thinking; only used tokens are billed
				max_tokens: req.maxTokens ?? 8000,
				messages: [
					{ role: 'system', content: req.system },
					{ role: 'user', content: req.user }
				],
				response_format: {
					type: 'json_schema',
					json_schema: { name: req.schemaName, strict: true, schema: req.schema }
				}
			}),
			signal: AbortSignal.timeout(120_000)
		});
		if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const data = (await res.json()) as {
			model?: string;
			choices?: { message?: { content?: string }; finish_reason?: string }[];
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};
		const choice = data.choices?.[0];
		if (choice?.finish_reason === 'length') throw new Error('AI answer was cut off (max_tokens)');
		const text = choice?.message?.content ?? '';
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			throw new Error(`AI answer is not JSON: ${text.slice(0, 200)}`);
		}
		return {
			json,
			model: data.model || config.model,
			usage: data.usage
				? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
				: null
		};
	};
}
