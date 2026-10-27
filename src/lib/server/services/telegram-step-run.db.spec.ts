// Executable steps on Telegram (P2-13): the strategy AI writes system actions into a plan; Simpan
// shows Jalankan under it; Jalankan sends a preview that a reply completes; Simpan writes it once.
// Fake AI and Telegram; rolled-back transaction on the Neon `dev` branch or localhost only.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AiComplete, AiRequest } from '../ai/client';
import { STEP_RUN_FIELDS } from '../ai/prompts/step-run';
import { INPUT_SCHEMA, type InputAnswer } from '../ai/prompts/telegram-input';
import { createDb, type Tx } from '../db/client';
import { action, client, deal, telegramDraft, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { createClient } from './clients';
import { createDeal } from './deals';
import { cancelDraft, confirmDraft, processInbound, type InboundDeps } from './telegram-input';
import { startStepRun } from './telegram-step-run';

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

const CHAT = '999000333';
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
			const c = await createClient(tx, clientSchema.parse({ name: 'PT ZZ Aksi Chat' }), u.id);
			const d = await createDeal(
				tx,
				dealSchema.parse({
					clientId: c.id,
					title: 'Sistem gudang',
					stage: 'meeting',
					firstStepTitle: 'Telepon PIC',
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

const refIn = (req: AiRequest, name: string) =>
	req.user
		.split('\n')
		.find((l) => l.includes(name))!
		.split(' | ')[0];

/** Fake Telegram + AI: the input reader, the strategy chat and the Jalankan correction */
function fakes(dealId: string, correction: (req: AiRequest) => Record<string, unknown>) {
	const sent: { html: string; buttons: string[]; id: number }[] = [];
	const cleared: number[] = [];
	const requests: AiRequest[] = [];
	const complete: AiComplete = async (req) => {
		requests.push(req);
		let json: unknown;
		if (req.schemaName === 'strategi_telegram')
			json = {
				leave: false,
				reply: 'Profil klien masih tipis; lengkapi dulu, lalu dorong ke proposal.',
				proposal_action: 'new_plan',
				target_id: dealId,
				plan_id: '',
				goal: 'Proposal sistem gudang terkirim',
				target_date: '2026-11-13',
				steps: [
					'2026-10-26T10:00 | Lengkapi profil klien | profil; industri=logistics',
					'2026-10-27T10:00 | Kirim proposal ke PIC',
					`2026-10-28T10:00 | Pindahkan deal ke Proposal | pindah_deal; deal=${dealId}; tahap=proposal`,
					// an invoice the client does not have: stays a reminder
					'2026-10-29T10:00 | Catat pembayaran DP | bayar_invoice; invoice=TIDAK-ADA'
				]
			};
		else if (req.schemaName === 'aksi_langkah')
			json = {
				leave: false,
				reply: '',
				...Object.fromEntries(STEP_RUN_FIELDS.map((f) => [f, ''])),
				...correction(req)
			};
		else
			json = req.user.includes('Lead baru PT Lain')
				? { ...emptyInput(), intent: 'unknown', reply: 'Kontaknya siapa?' }
				: { ...emptyInput(), intent: 'strategy', target: refIn(req, 'PT ZZ Aksi Chat') };
		return { json, model: 'fake', usage: null };
	};
	const send = async (html: string, buttons: { data: string }[] = []) => {
		const id = sent.length + 700;
		sent.push({ html, buttons: buttons.map((b) => b.data), id });
		return id;
	};
	const clearButtons = async (id: number) => {
		cleared.push(id);
	};
	const deps: InboundDeps = {
		complete,
		transcribe: async () => '',
		download: async () => ({ data: new Blob(['x']), name: 'x.ogg' }),
		send,
		clearButtons
	};
	return { deps, sent, cleared, requests, telegram: { send, clearButtons } };
}

describe.skipIf(!isDevDb)('Jalankan on Telegram (dev database)', () => {
	it(
		'saves a plan with action steps, runs one after a chat correction, once',
		{ timeout: 120_000 },
		() =>
			inRollback(async ({ tx, userId, dealId, clientId }) => {
				const f = fakes(dealId, (req) =>
					req.user.includes('Lead baru PT Lain')
						? { leave: true }
						: {
								reply: 'Kota dan kebutuhan sudah diisi.',
								industry: 'logistics',
								source: '',
								city: 'Surabaya',
								context_add:
									'Butuh sistem gudang untuk 3 cabang; keputusan di direktur operasional.'
							}
				);
				const inbound = (text: string) =>
					processInbound(tx, { chatId: CHAT, userId, text }, f.deps, now);

				// The strategy turn sees what is missing in the profile, and marks the action steps
				expect((await inbound('Strategi untuk ZZ Aksi Chat?')).status).toBe('strategy');
				const asked = f.requests.find((r) => r.schemaName === 'strategi_telegram')!;
				expect(asked.system).toContain('pindah_deal; deal=<id deal_terbuka>');
				expect(asked.user).toMatch(/profil \(JSON\): \{"terisi":\[[^\]]*\],"kosong":\["industri"/);
				const proposal = f.sent.at(-1)!.html;
				expect(proposal).toContain('Lengkapi profil klien <i>[Lengkapi profil klien]</i>');
				expect(proposal).toContain('Pindahkan deal ke Proposal <i>[Pindahkan deal]</i>');
				expect(proposal).toContain('Catat pembayaran DP');
				expect(proposal).not.toContain('[Catat pembayaran]');

				// Simpan: one Jalankan per action step, the reminders have none
				const [chatRow] = await tx
					.select()
					.from(telegramDraft)
					.where(and(eq(telegramDraft.chatId, CHAT), eq(telegramDraft.kind, 'strategy')));
				const saved = await confirmDraft(
					tx,
					{ draftId: chatRow.id, chatId: CHAT, appUrl: APP },
					now
				);
				expect(saved.html).toContain('Langkah aksi bisa dijalankan');
				const steps = await tx
					.select({ id: action.id, title: action.title, kind: action.kind })
					.from(action)
					.where(eq(action.dealId, dealId));
				const byTitle = (t: string) => steps.find((s) => s.title === t)!;
				expect(byTitle('Kirim proposal ke PIC').kind).toBe('reminder');
				expect(byTitle('Catat pembayaran DP').kind).toBe('reminder');
				const profile = byTitle('Lengkapi profil klien');
				const move = byTitle('Pindahkan deal ke Proposal');
				expect(saved.buttons).toEqual([
					[{ text: 'Jalankan: Lengkapi profil klien', data: `x:${profile.id}` }],
					[{ text: 'Jalankan: Pindahkan deal ke Proposal', data: `x:${move.id}` }]
				]);

				// Jalankan: a preview with Simpan / Batal
				expect(
					(await startStepRun(tx, { stepId: profile.id, chatId: CHAT, userId }, f.telegram, now))
						.toast
				).toBe('Periksa lalu tekan Simpan.');
				const preview = f.sent.at(-1)!;
				expect(preview.html).toContain('Jalankan · Lengkapi profil klien');
				expect(preview.html).toContain('Industri: (kosong) → <b>Logistik</b>');
				expect(preview.buttons[0]).toMatch(/^s:/);
				const runId = preview.buttons[0].slice(2);

				// A message about something else goes to the normal input, the preview stays
				const before = f.sent.length;
				expect((await inbound('Lead baru PT Lain Sekali')).status).not.toBe('step_run');
				expect(f.sent.length).toBe(before + 1);

				// A reply completes it: a new preview replaces the old one
				expect(await inbound('kotanya Surabaya, butuh sistem gudang 3 cabang')).toEqual({
					status: 'step_run',
					draftId: runId
				});
				expect(f.cleared).toContain(preview.id);
				const revised = f.sent.at(-1)!.html;
				expect(revised).toContain('Kota dan kebutuhan sudah diisi.');
				expect(revised).toContain('Kota: (kosong) → <b>Surabaya</b>');
				expect(revised).toContain('direktur operasional');

				// Simpan writes it and ticks the step off, once
				const done = await confirmDraft(tx, { draftId: runId, chatId: CHAT, appUrl: APP }, now);
				expect(done.toast).toBe('Tersimpan.');
				expect(done.html).toContain('Langkahnya ditandai selesai.');
				const [c] = await tx.select().from(client).where(eq(client.id, clientId));
				expect(c).toMatchObject({ industry: 'logistics', city: 'Surabaya' });
				expect(
					(await confirmDraft(tx, { draftId: runId, chatId: CHAT, appUrl: APP }, now)).toast
				).toBe('Aksi ini sudah dijalankan.');
				expect(
					(await startStepRun(tx, { stepId: profile.id, chatId: CHAT, userId }, f.telegram, now))
						.toast
				).toBe('Langkah ini sudah selesai.');

				// Batal writes nothing; Jalankan again, then Simpan moves the deal
				await startStepRun(tx, { stepId: move.id, chatId: CHAT, userId }, f.telegram, now);
				const moveRun = f.sent.at(-1)!.buttons[1].slice(2);
				expect(f.sent.at(-1)!.html).toContain('Deal <b>Sistem gudang</b>: Meeting');
				const cancelled = await cancelDraft(tx, { draftId: moveRun, chatId: CHAT }, now);
				expect(cancelled.html).toContain('langkahnya tetap terbuka');
				expect((await tx.select().from(deal).where(eq(deal.id, dealId)))[0].stage).toBe('meeting');
				await startStepRun(tx, { stepId: move.id, chatId: CHAT, userId }, f.telegram, now);
				const moveRun2 = f.sent.at(-1)!.buttons[0].slice(2);
				await confirmDraft(tx, { draftId: moveRun2, chatId: CHAT, appUrl: APP }, now);
				expect((await tx.select().from(deal).where(eq(deal.id, dealId)))[0].stage).toBe('proposal');
			})
	);
});
