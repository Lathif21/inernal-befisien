// Speech to text for Telegram voice notes (P2-10): Groq's OpenAI-compatible Whisper endpoint.
// Relative imports only and config passed in: the Trigger.dev task uses this.

/** The one thing the bot needs from speech to text; tests pass a fake */
export type Transcribe = (audio: Blob, filename: string) => Promise<string>;

/** whisper-large-v3 reads Indonesian names and numbers better than the turbo model */
export const DEFAULT_STT_MODEL = 'whisper-large-v3';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Words Whisper should expect (the prompt steers spelling; max ~220 tokens) */
const VOCABULARY =
	'Catatan CRM Befisien dalam Bahasa Indonesia: klien, PT, CV, deal, lead, proposal, negosiasi, meeting, follow up, invoice, Rupiah, juta, miliar, WhatsApp, website, dashboard, AI agent, otomasi, integrasi.';

export function groqTranscriber(config: { apiKey: string; model?: string }): Transcribe {
	return async (audio, filename) => {
		if (!config.apiKey) throw new Error('GROQ_API_KEY is not set');
		const form = new FormData();
		form.append('file', audio, filename);
		form.append('model', config.model || DEFAULT_STT_MODEL);
		form.append('language', 'id');
		form.append('prompt', VOCABULARY);
		form.append('response_format', 'json');
		form.append('temperature', '0');
		const res = await fetch(GROQ_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${config.apiKey}` },
			body: form,
			signal: AbortSignal.timeout(60_000)
		});
		if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const data = (await res.json()) as { text?: string };
		return (data.text ?? '').trim();
	};
}
