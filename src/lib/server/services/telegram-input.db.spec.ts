// Database tests for Telegram input (P2-10): message → draft → Simpan / Batal, with a fake AI and a
// fake Telegram. Neon `dev` branch (or localhost) only, inside a transaction that is always rolled back.
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { INPUT_SCHEMA, type InputAnswer } from '../ai/prompts/telegram-input';
import type { AiComplete, AiRequest } from '../ai/client';
import { createDb, type Tx } from '../db/client';
import {
	action,
	activity,
	client,
	deal,
	project,
	strategyPlan,
	telegramDraft,
	user
} from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { createClient } from './clients';
import { createDeal } from './deals';
import {
	cancelDraft,
	confirmDraft,
	processInbound,
	type InboundDeps,
	type InboundPayload
} from './telegram-input';

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

const CHAT = '999000111';
const APP = 'https://crm.example';

type Ctx = { tx: Tx; userId: string; dealId: string; clientId: string };

async function inRollback(fn: (c: Ctx) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			// This user is the sender; the rollback restores their real chat id
			await tx.update(user).set({ telegramChatId: null }).where(eq(user.telegramChatId, CHAT));
			await tx.update(user).set({ telegramChatId: CHAT }).where(eq(user.id, u.id));
			const c = await createClient(tx, clientSchema.parse({ name: 'PT ZZ Telegram Satu' }), u.id);
			const d = await createDeal(
				tx,
				dealSchema.parse({
					clientId: c.id,
					title: 'Chatbot layanan',
					stage: 'proposal',
					valueEstimate: 40_000_000,
					firstStepTitle: 'Follow up proposal',
					firstStepDue: '2030-01-02T10:00'
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

const empty = (): InputAnswer => ({
	...(Object.fromEntries(
		Object.keys(INPUT_SCHEMA.properties).map((k) => [k, ''])
	) as unknown as InputAnswer),
	intent: 'unknown',
	revises_previous: false,
	plan_steps: []
});

/** The ref the prompt gave a client or card, found by its name */
function refIn(req: AiRequest, name: string) {
	const line = req.user.split('\n').find((l) => l.includes(name));
	if (!line) throw new Error(`"${name}" is not in the prompt`);
	return line.split(' | ')[0];
}

/** A fake Telegram + AI; `answers` builds the AI answer from the request */
function fakes(answers: (req: AiRequest) => Partial<InputAnswer>) {
	const sent: { html: string; buttons: number; id: number }[] = [];
	const cleared: number[] = [];
	const requests: AiRequest[] = [];
	const complete: AiComplete = async (req) => {
		requests.push(req);
		return { json: { ...empty(), ...answers(req) }, model: 'fake', usage: null };
	};
	const deps: InboundDeps = {
		complete,
		transcribe: async () => 'besok jam 3 sore telepon pak andi soal chatbot',
		download: async () => ({ data: new Blob(['ogg']), name: 'voice.ogg' }),
		send: async (html, buttons = []) => {
			const id = sent.length + 100;
			sent.push({ html, buttons: buttons.length, id });
			return id;
		},
		clearButtons: async (id) => {
			cleared.push(id);
		}
	};
	return { deps, sent, cleared, requests };
}

const textFrom = (userId: string, text: string): InboundPayload => ({ chatId: CHAT, userId, text });
// Saturday 24 Oct 2026 09:00 WIB
const now = new Date('2026-10-24T02:00:00Z');

describe.skipIf(!isDevDb)('telegram input (dev database)', () => {
	it('lead: draft, then Simpan writes the client, contact and deal once', { timeout: 60_000 }, () =>
		inRollback(async ({ tx, userId }) => {
			const f = fakes(() => ({
				intent: 'lead',
				client_name: 'PT ZZ Telegram Dua',
				city: 'Surabaya',
				contact_name: 'Andi',
				contact_phone: '0812 1111 2222',
				deal_title: 'Dashboard stok',
				service_type: 'dashboard_app',
				deal_value: '30000000',
				next_action: 'Kirim proposal',
				next_action_due: '2026-10-27T10:00'
			}));
			const r = await processInbound(tx, textFrom(userId, 'lead baru ...'), f.deps, now);
			expect(r).toMatchObject({ status: 'draft', kind: 'lead', replaced: false });
			expect(f.sent).toHaveLength(1);
			expect(f.sent[0]).toMatchObject({ buttons: 2 });
			expect(f.sent[0].html).toContain('PT ZZ Telegram Dua');
			if (r.status !== 'draft') return;

			// Nothing in the CRM before Simpan
			const before = await tx.select().from(client).where(eq(client.name, 'PT ZZ Telegram Dua'));
			expect(before).toHaveLength(0);

			const saved = await confirmDraft(tx, { draftId: r.draftId, chatId: CHAT, appUrl: APP }, now);
			expect(saved.toast).toBe('Tersimpan.');
			expect(saved.html).toContain('klien baru, kontak ditambahkan, deal dibuat');
			expect(saved.html).toContain(`${APP}/clients/`);

			const [c] = await tx.select().from(client).where(eq(client.name, 'PT ZZ Telegram Dua'));
			const [d] = await tx.select().from(deal).where(eq(deal.clientId, c.id));
			expect(d).toMatchObject({
				title: 'Dashboard stok',
				stage: 'lead',
				valueEstimate: 30_000_000
			});
			const steps = await tx.select().from(action).where(eq(action.dealId, d.id));
			expect(steps.map((s) => s.title)).toEqual(['Kirim proposal']);

			// A second tap does nothing
			const again = await confirmDraft(tx, { draftId: r.draftId, chatId: CHAT, appUrl: APP }, now);
			expect(again).toEqual({ toast: 'Draf ini sudah disimpan.' });
			const clients = await tx.select().from(client).where(eq(client.name, 'PT ZZ Telegram Dua'));
			expect(clients).toHaveLength(1);
		})
	);

	it('step from a voice note, on the deal the AI picked by ref', { timeout: 60_000 }, () =>
		inRollback(async ({ tx, userId, dealId }) => {
			const f = fakes((req) => ({
				intent: 'step',
				target: refIn(req, 'Chatbot layanan'),
				step_title: 'Telepon Pak Andi soal chatbot',
				step_due: '2026-10-25T15:00'
			}));
			const r = await processInbound(
				tx,
				{ chatId: CHAT, userId, voice: { fileId: 'f1', duration: 8 } },
				f.deps,
				now
			);
			expect(r).toMatchObject({ status: 'draft', kind: 'step' });
			expect(f.requests[0].user).toContain('Transkrip voice note:');
			expect(f.sent[0].html).toContain('Voice note: "besok jam 3 sore');
			if (r.status !== 'draft') return;
			await confirmDraft(tx, { draftId: r.draftId, chatId: CHAT, appUrl: APP }, now);
			const open = await tx
				.select({ title: action.title })
				.from(action)
				.where(and(eq(action.dealId, dealId), isNull(action.doneAt)));
			expect(open.map((s) => s.title).sort()).toEqual([
				'Follow up proposal',
				'Telepon Pak Andi soal chatbot'
			]);
		})
	);

	it(
		'move to won creates the project; plan and note go through the services',
		{ timeout: 60_000 },
		() =>
			inRollback(async ({ tx, userId, dealId, clientId }) => {
				const plan = fakes((req) => ({
					intent: 'plan',
					target: refIn(req, 'Chatbot layanan'),
					plan_goal: 'Closing akhir bulan',
					plan_steps: ['2026-10-28T10:00 | Meeting harga']
				}));
				const p = await processInbound(tx, textFrom(userId, 'rencana ...'), plan.deps, now);
				if (p.status !== 'draft') throw new Error('expected a plan draft');
				await confirmDraft(tx, { draftId: p.draftId, chatId: CHAT, appUrl: APP }, now);
				const [sp] = await tx.select().from(strategyPlan).where(eq(strategyPlan.dealId, dealId));
				expect(sp.goal).toBe('Closing akhir bulan');
				const planSteps = await tx.select().from(action).where(eq(action.planId, sp.id));
				expect(planSteps.map((s) => s.title)).toEqual(['Meeting harga']);

				const note = fakes((req) => ({
					intent: 'note',
					target: refIn(req, 'PT ZZ Telegram Satu'),
					note_type: 'call',
					note_body: 'Minta diskon 10%'
				}));
				const n = await processInbound(tx, textFrom(userId, 'catatan ...'), note.deps, now);
				if (n.status !== 'draft') throw new Error('expected a note draft');
				await confirmDraft(tx, { draftId: n.draftId, chatId: CHAT, appUrl: APP }, now);
				const [logged] = await tx
					.select()
					.from(activity)
					.where(and(eq(activity.clientId, clientId), eq(activity.type, 'call')));
				expect(logged).toMatchObject({
					body: 'Minta diskon 10%',
					userId,
					meta: { via: 'telegram' }
				});

				const move = fakes((req) => ({
					intent: 'move',
					target: refIn(req, 'Chatbot layanan'),
					to_stage: 'won'
				}));
				const m = await processInbound(tx, textFrom(userId, 'deal menang'), move.deps, now);
				if (m.status !== 'draft') throw new Error('expected a move draft');
				const saved = await confirmDraft(
					tx,
					{ draftId: m.draftId, chatId: CHAT, appUrl: APP },
					now
				);
				expect(saved.html).toContain('deal pindah ke Deal ✓, proyek dibuat');
				const [pr] = await tx.select().from(project).where(eq(project.dealId, dealId));
				expect(pr).toMatchObject({ name: 'Chatbot layanan', contractValue: 40_000_000 });
			})
	);

	it(
		'a correction replaces the open draft; Batal and expiry write nothing',
		{ timeout: 60_000 },
		() =>
			inRollback(async ({ tx, userId, dealId }) => {
				const first = fakes((req) => ({
					intent: 'step',
					target: refIn(req, 'Chatbot layanan'),
					step_title: 'Demo chatbot',
					step_due: '2026-10-27T10:00'
				}));
				const a = await processInbound(tx, textFrom(userId, 'demo senin jam 10'), first.deps, now);
				if (a.status !== 'draft') throw new Error('expected a draft');

				const fix = fakes((req) => {
					// The open draft is in the prompt with refs, not ids
					expect(req.user).toContain('draf_sebelumnya (JSON)');
					expect(req.user).not.toContain(dealId);
					return {
						intent: 'step',
						revises_previous: true,
						target: refIn(req, 'Chatbot layanan'),
						step_title: 'Demo chatbot',
						step_due: '2026-10-27T14:00'
					};
				});
				const b = await processInbound(tx, textFrom(userId, 'jamnya jam 2'), fix.deps, now);
				expect(b).toMatchObject({ status: 'draft', replaced: true });
				expect(fix.cleared).toEqual([100]);
				if (b.status !== 'draft') return;
				expect(
					await confirmDraft(tx, { draftId: a.draftId, chatId: CHAT, appUrl: APP }, now)
				).toEqual({ toast: 'Draf ini sudah diganti dengan koreksi terbaru.' });

				// Another chat cannot touch it
				expect(await cancelDraft(tx, { draftId: b.draftId, chatId: '1' }, now)).toEqual({
					toast: 'Draf tidak ditemukan.'
				});
				const cancelled = await cancelDraft(tx, { draftId: b.draftId, chatId: CHAT }, now);
				expect(cancelled.html).toContain('Dibatalkan.');

				const c = await processInbound(tx, textFrom(userId, 'demo lagi'), first.deps, now);
				if (c.status !== 'draft') throw new Error('expected a draft');
				const late = new Date(now.getTime() + 31 * 60_000);
				expect(
					await confirmDraft(tx, { draftId: c.draftId, chatId: CHAT, appUrl: APP }, late)
				).toMatchObject({ toast: 'Draf sudah kedaluwarsa.' });

				const demos = await tx
					.select()
					.from(action)
					.where(and(eq(action.dealId, dealId), eq(action.title, 'Demo chatbot')));
				expect(demos).toHaveLength(0);
				const drafts = await tx.select().from(telegramDraft).where(eq(telegramDraft.chatId, CHAT));
				expect(drafts.map((d) => d.status).sort()).toEqual(['cancelled', 'pending', 'replaced']);
			})
	);

	it(
		'an unclear message gets the problems and no draft; an unlinked user gets nothing',
		{ timeout: 60_000 },
		() =>
			inRollback(async ({ tx, userId }) => {
				const f = fakes(() => ({ intent: 'move', reply: 'Ada dua deal Sinar Jaya.' }));
				const r = await processInbound(tx, textFrom(userId, 'sinar jaya menang'), f.deps, now);
				expect(r.status).toBe('unclear');
				expect(f.sent[0].html).toContain('Ada dua deal Sinar Jaya.');
				expect(f.sent[0].buttons).toBe(0);

				const other = await processInbound(tx, { chatId: '1', userId, text: 'halo' }, f.deps, now);
				expect(other).toEqual({ status: 'not-linked' });
			})
	);
});
