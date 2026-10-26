// LLM access for AI suggestions (P2-01). Sumopod is an OpenAI-compatible gateway
// (https://ai.sumopod.com/v1); `response_format: json_schema` is passed through to the model.
// Relative imports only and config passed in: the Trigger.dev tasks use this too.

export type AiConfig = {
	apiKey: string;
	/** e.g. claude-opus-5-5 (default), claude-sonnet-5-5, claude-haiku-5-5 */
	model: string;
	baseUrl?: string;
	/** default 120 s */
	timeoutMs?: number;
};

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export const DEFAULT_AI_BASE_URL = 'https://ai.sumopod.com/v1';

/** 9router, an OpenAI-compatible proxy; runs on the machine at port 20128 by default */
export const DEFAULT_ANALYSIS_BASE_URL = 'http://localhost:20128/v1';
export const DEFAULT_ANALYSIS_MODEL = 'cc/claude-opus-5-5';

export type AiRequest = {
	system: string;
	user: string;
	/** JSON Schema the answer must follow (strict) */
	schema: Record<string, unknown>;
	schemaName: string;
	maxTokens?: number;
	/** The answer may be plain text when the model ignores the schema (one-text answers) */
	allowText?: boolean;
};

export type AiResult = {
	/** Parsed JSON, or the text itself with `allowText`; still to be validated by the caller */
	json: unknown;
	model: string;
	usage: { input: number; output: number } | null;
};

/** The one thing the services need from an LLM; tests pass a fake */
export type AiComplete = (req: AiRequest) => Promise<AiResult>;

export function sumopodClient(config: AiConfig): AiComplete {
	const baseUrl = (config.baseUrl || DEFAULT_AI_BASE_URL).replace(/\/$/, '');
	return async (req) => {
		if (!config.apiKey) throw new Error('AI API key is not set');
		const res = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${config.apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: config.model,
				// 9router streams unless told not to
				stream: false,
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
			signal: AbortSignal.timeout(config.timeoutMs ?? 120_000)
		});
		if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const data = (await res.json()) as {
			model?: string;
			choices?: { message?: { content?: string }; finish_reason?: string }[];
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};
		const choice = data.choices?.[0];
		if (choice?.finish_reason === 'length') throw new Error('AI answer was cut off (max_tokens)');
		// Some models wrap the JSON in a ```json fence, or skip the schema and answer in prose
		const text = (choice?.message?.content ?? '')
			.trim()
			.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			if (!req.allowText || !text) throw new Error(`AI answer is not JSON: ${text.slice(0, 200)}`);
			json = text;
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

/**
 * The model for analysis a person asks for (Telegram strategy chat, "Minta saran AI"): 9router
 * when its key is set (NINEROUTER_API_KEY / NINEROUTER_MODEL / NINEROUTER_BASE_URL), otherwise
 * `fallback`. Background jobs and message parsing stay on the cheaper default model.
 */
export function analysisClient(
	nineRouter: { apiKey?: string; model?: string; baseUrl?: string },
	fallback: AiComplete
): AiComplete {
	if (!nineRouter.apiKey) return fallback;
	return sumopodClient({
		apiKey: nineRouter.apiKey,
		model: nineRouter.model || DEFAULT_ANALYSIS_MODEL,
		baseUrl: nineRouter.baseUrl || DEFAULT_ANALYSIS_BASE_URL,
		// A reasoning model with a high thinking budget; telegram-inbound allows 300 s in total
		timeoutMs: 240_000
	});
}
