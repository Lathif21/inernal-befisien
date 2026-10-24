// Strategy chat on Telegram: "strategi untuk …?" → overview, open suggestions with Terima / Abaikan,
// the AI's answer and proposal; follow-ups continue the conversation; Simpan writes the plan once.
// Fake AI and Telegram; rolled-back transaction on the Neon `dev` branch or localhost only.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AiComplete, AiRequest } from '../ai/client';
import { INPUT_SCHEMA, type InputAnswer } from '../ai/prompts/telegram-input';
import { createDb, type Tx } from '../db/client';
import { action, aiSuggestion, strategyPlan, telegramDraft, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { createClient } from './clients';
import { createDeal } from './deals';
import { cancelDraft, confirmDraft, processInbound, type InboundDeps } from './telegram-input';
import { acceptSuggestionFromChat, dismissSuggestionFromChat } from './telegram-strategy';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const url = process.env.DATABASE_URL;
const isDevDb =
	!!url &&
	(process.env.NEON_BRANCH === 'dev' || ['localhost', '127.0.0.1'].includes(new URL(url).hostname));

class Rollback extends Error {}

const CHAT = '999000222';
const APP = 'https://crm.example';
// Saturday 24 Oct 2026 09:00 WIB
const now = new Date('2026-10-24T02:00:00Z');

type Ctx = { tx: Tx; userId: string; dealId: string; clientId: string };

async function inRollback(fn: (c: Ctx) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			await tx.update(user).set({ telegramChatId: null }).where(eq(user.telegramChatId, CHAT));
			await tx.update(user).set({ telegramChatId: CHAT }).where(eq(user.id, u.id));
			const c = await createClient(tx, clientSchema.parse({ name: 'PT ZZ Strategi Chat' }), u.id);
			const d = await createDeal(
				tx,
				dealSchema.parse({
					clientId: c.id,
					title: 'Dashboard produksi',
					stage: 'proposal',
					valueEstimate: 60_000_000,
					firstStepTitle: 'Follow up proposal',
					firstStepDue: '2026-10-27T10:00'
				}),
				u.id
			);
			await fn({ tx, userId: u.id, dealId: d.id, clientId: c.id });
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

const emptyInput = (): InputAnswer => ({
	...(Object.fromEntries(
		Object.keys(INPUT_SCHEMA.properties).map((k) => [k, ''])
	) as unknown as InputAnswer),
	intent: 'unknown',
	revises_previous: false,
	plan_steps: []
});

const strategyAnswer = (fields: Record<string, unknown>) => ({
	leave: false,
	reply: '',
	proposal_action: 'keep',
	target_id: '',
	plan_id: '',
	goal: '',
	target_date: '',
	steps: [],
	...fields
});

/** Fake Telegram + AI: `input` answers the data prompt, `strategy` the strategy chat */
function fakes(
	input: (req: AiRequest) => Partial<InputAnswer>,
	strategy: (req: AiRequest, n: number) => Record<string, unknown>
) {
	const sent: { html: string; buttons: string[]; id: number }[] = [];
	const cleared: number[] = [];
	const requests: AiRequest[] = [];
	let turns = 0;
	const complete: AiComplete = async (req) => {
		requests.push(req);
		const json =
			req.schemaName === 'strategi_telegram'
				? strategyAnswer(strategy(req, ++turns))
				: { ...emptyInput(), ...input(req) };
		return { json, model: 'fake', usage: null };
	};
	const deps: InboundDeps = {
		complete,
		transcribe: async () => '',
		download: async () => ({ data: new Blob(['x']), name: 'x.ogg' }),
		send: async (html, buttons = []) => {
			const id = sent.length + 500;
			sent.push({ html, buttons: buttons.map((b) => b.data), id });
			return id;
		},
		clearButtons: async (id) => {
			cleared.push(id);
		}
	};
	return { deps, sent, cleared, requests };
}

const refIn = (req: AiRequest, name: string) =>
	req.user
		.split('\n')
		.find((l) => l.includes(name))!
		.split(' | ')[0];

describe.skipIf(!isDevDb)('telegram strategy chat (dev database)', () => {
	it('answers, discusses and saves a proposed plan once', { timeout: 120_000 }, () =>
		inRollback(async ({ tx, userId, dealId, clientId }) => {
			const [suggestion] = await tx
				.insert(aiSuggestion)
				.values({
					clientId,
					dealId,
					kind: 'pipeline',
					insight: 'Proposal belum dibalas 5 hari.',
					proposedAction: 'Telepon Pak Andi untuk konfirmasi proposal',
					model: 'fake',
					inputHash: 'test'
				})
				.returning();
			const f = fakes(
				(req) =>
					req.user.includes('Lead baru PT Lain')
						? { intent: 'unknown', reply: 'Kontaknya siapa?' }
						: { intent: 'strategy', target: refIn(req, 'PT ZZ Strategi Chat') },
				(req, n) => {
					if (n === 1)
						return {
							reply: 'Deal Dashboard produksi menunggu jawaban proposal. Usul rencana closing.',
							proposal_action: 'new_plan',
							target_id: dealId,
							goal: 'Closing dashboard produksi bulan ini',
							target_date: '2026-11-30',
							steps: [
								'2026-10-26T10:00 | Telepon Pak Andi',
								'2026-10-28T14:00 | Demo ulang ke direksi'
							]
						};
					if (n === 2)
						return { reply: 'Karena direksi belum melihat demo.', proposal_action: 'keep' };
					if (n === 3)
						return {
							reply: 'Sudah dimajukan.',
							proposal_action: 'new_plan',
							target_id: dealId,
							goal: 'Closing dashboard produksi bulan ini',
							target_date: '2026-11-30',
							steps: [
								'2026-10-26T10:00 | Telepon Pak Andi',
								'2026-10-27T14:00 | Demo ulang ke direksi'
							]
						};
					if (n === 4) return { leave: true }; // a new lead for another company
					// n === 5, a new conversation: move one step of the saved plan, add one
					const planId = /"id":"([0-9a-f-]{36})","tujuan":"Closing dashboard/.exec(req.user)?.[1];
					const ref = /"ref":"(L\d+)","judul":"Demo ulang ke direksi"/.exec(req.user)?.[1];
					return {
						reply: 'Demo dimundurkan, dan ringkasan dikirim sesudahnya.',
						proposal_action: 'update_plan',
						plan_id: planId,
						steps: [
							`${ref} | 2026-10-29T14:00 | Demo ulang ke direksi`,
							'baru | 2026-10-30T10:00 | Kirim ringkasan demo lewat WhatsApp'
						]
					};
				}
			);
			const send = (text: string) =>
				processInbound(tx, { chatId: CHAT, userId, text }, f.deps, now);

			// 1. the question: overview, the suggestion with Terima / Abaikan, the answer with Simpan
			const first = await send('Strategi untuk ZZ Strategi Chat?');
			expect(first).toMatchObject({ status: 'strategy', clientId, proposal: true });
			expect(f.sent[0].html).toContain('Strategi · PT ZZ Strategi Chat');
			expect(f.sent[0].html).toContain('Belum ada rencana aktif.');
			expect(f.sent[1].buttons).toEqual([`a:${suggestion.id}`, `d:${suggestion.id}`]);
			expect(f.sent[2].html).toContain('Usulan rencana baru');
			expect(f.sent[2].html).toContain('Telepon Pak Andi');
			const chatData = f.requests.find((r) => r.schemaName === 'strategi_telegram')!.user;
			expect(chatData).toContain('Dashboard produksi');
			expect(chatData).toContain('Proposal belum dibalas 5 hari.');

			// 2. a question keeps the proposal; 3. a change replaces it (old buttons removed)
			expect((await send('Kenapa demo ulang?')).status).toBe('strategy');
			expect(f.sent.at(-1)!.html).toContain('Karena direksi belum melihat demo.');
			expect(f.sent.at(-1)!.html).toContain('Demo ulang ke direksi');
			await send('Majukan demonya ke Selasa');
			expect(f.sent.at(-1)!.html).toContain('Selasa, 27 Okt 2026 14:00 WIB');
			expect(f.cleared).toEqual([f.sent[2].id, f.sent[3].id]);
			const history = f.requests.filter((r) => r.schemaName === 'strategi_telegram').at(-1)!.user;
			expect(history).toContain('Tim: Kenapa demo ulang?');

			// 4. something else goes to the normal input; the conversation stays open
			const before = f.sent.length;
			const left = await send('Lead baru PT Lain Sekali');
			expect(left.status).not.toBe('strategy');
			expect(f.sent.length).toBe(before + 1);

			// Simpan writes the plan with its 2 steps, once
			const [row] = await tx
				.select()
				.from(telegramDraft)
				.where(and(eq(telegramDraft.chatId, CHAT), eq(telegramDraft.kind, 'strategy')));
			const saved = await confirmDraft(tx, { draftId: row.id, chatId: CHAT, appUrl: APP }, now);
			expect(saved.toast).toBe('Tersimpan.');
			expect(saved.html).toContain('rencana dengan 2 langkah');
			const [plan] = await tx
				.select()
				.from(strategyPlan)
				.where(and(eq(strategyPlan.dealId, dealId), eq(strategyPlan.status, 'active')));
			expect(plan.goal).toBe('Closing dashboard produksi bulan ini');
			const steps = await tx.select().from(action).where(eq(action.planId, plan.id));
			expect(steps.map((s) => s.title).sort()).toEqual([
				'Demo ulang ke direksi',
				'Telepon Pak Andi'
			]);
			expect(
				(await confirmDraft(tx, { draftId: row.id, chatId: CHAT, appUrl: APP }, now)).toast
			).toBe('Usulan ini sudah disimpan.');
			expect((await cancelDraft(tx, { draftId: row.id, chatId: CHAT }, now)).toast).toBe(
				'Draf ini sudah disimpan.'
			);

			// Terima turns the suggestion into a step; a second tap is refused
			const accepted = await acceptSuggestionFromChat(
				tx,
				{ suggestionId: suggestion.id, userId },
				now
			);
			expect(accepted.toast).toBe('Langkah ditambahkan.');
			expect(accepted.html).toContain('Diterima:');
			expect(
				(await dismissSuggestionFromChat(tx, { suggestionId: suggestion.id, userId }, now)).toast
			).toBe('Saran ini sudah diterima.');

			// A new conversation changes the saved plan: one step moved, one added
			const next = await send('Strategi untuk ZZ Strategi Chat lagi');
			expect(next).toMatchObject({ status: 'strategy', proposal: true });
			const shown = f.sent.at(-1)!.html;
			expect(shown).toContain('Usulan perubahan rencana');
			expect(shown).toContain('(sebelumnya Selasa, 27 Okt 2026 14:00 WIB)');
			expect(shown).toContain('(baru)');
			const [row2] = await tx
				.select()
				.from(telegramDraft)
				.where(
					and(
						eq(telegramDraft.chatId, CHAT),
						eq(telegramDraft.kind, 'strategy'),
						eq(telegramDraft.status, 'pending')
					)
				);
			const saved2 = await confirmDraft(tx, { draftId: row2.id, chatId: CHAT, appUrl: APP }, now);
			expect(saved2.html).toContain('1 langkah diubah, 1 langkah ditambahkan');
			const after = await tx.select().from(action).where(eq(action.planId, plan.id));
			expect(after.map((a) => a.title).sort()).toEqual([
				'Demo ulang ke direksi',
				'Kirim ringkasan demo lewat WhatsApp',
				'Telepon Pak Andi'
			]);
			const demo = after.find((a) => a.title === 'Demo ulang ke direksi')!;
			expect(demo.dueAt.toISOString()).toBe('2026-10-29T07:00:00.000Z'); // 14:00 WIB
		})
	);
});
