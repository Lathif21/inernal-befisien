// Telegram input (P2-10): the webhook queues one run per message; this transcribes a voice note,
// asks the AI for a draft and replies with Simpan / Batal. Runs on Trigger.dev, so it reads
// process.env and uses relative imports only.
import { logger, task } from '@trigger.dev/sdk';
import { DEFAULT_AI_MODEL, sumopodClient } from '../lib/server/ai/client';
import { groqTranscriber } from '../lib/server/ai/transcribe';
import { createDb } from '../lib/server/db/client';
import {
	clearTelegramButtons,
	downloadTelegramFile,
	sendTelegramMessage
} from '../lib/server/notify/telegram';
import { processInbound, type InboundPayload } from '../lib/server/services/telegram-input';

const env = (name: string) => process.env[name] ?? '';

export const telegramInbound = task({
	id: 'telegram-inbound',
	maxDuration: 180,
	// No retry: a second attempt could send a second draft for the same message
	retry: { maxAttempts: 1 },
	run: async (payload: InboundPayload) => {
		if (!env('DATABASE_URL')) throw new Error('DATABASE_URL is not set for this environment');
		const db = createDb(env('DATABASE_URL'));
		const token = env('TELEGRAM_BOT_TOKEN');
		const send = (html: string, buttons?: { text: string; data: string }[]) =>
			sendTelegramMessage(token, payload.chatId, html, buttons);
		try {
			const result = await processInbound(db, payload, {
				complete: sumopodClient({
					apiKey: env('SUMOPOD_API_KEY'),
					model: env('AI_MODEL') || DEFAULT_AI_MODEL,
					baseUrl: env('AI_BASE_URL') || undefined
				}),
				transcribe: groqTranscriber({ apiKey: env('GROQ_API_KEY') }),
				download: (fileId) => downloadTelegramFile(token, fileId),
				send,
				clearButtons: (messageId) => clearTelegramButtons(token, payload.chatId, messageId)
			});
			logger.info('processed', { ...result, voice: !!payload.voice });
			return result;
		} catch (e) {
			logger.error('failed', { error: String(e).slice(0, 500) });
			await send('Maaf, pesan ini gagal diproses. Coba kirim lagi sebentar lagi.').catch(() => {});
			throw e;
		} finally {
			await db.$client.end();
		}
	}
});
