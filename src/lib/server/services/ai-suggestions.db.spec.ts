// AI suggestions with a fake model (no network, no cost). Neon `dev` branch (or localhost) only,
// inside a transaction that is always rolled back.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AiComplete, AiRequest } from '../ai/client';
import { createDb, type Tx } from '../db/client';
import { action, activity, aiSuggestion, client, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { stepSchema } from '../../schemas/step';
import { addAction } from './actions';
import { createClient } from './clients';
import { createDeal } from './deals';
import { ServiceError } from './errors';
import {
	acceptSuggestion,
	activeClientIds,
	buildClientContext,
	dismissSuggestion,
	expireSuggestions,
	generateSuggestions,
	listOpenSuggestions
} from './ai-suggestions';

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

async function inRollback(fn: (tx: Tx, userId: string) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			await fn(tx, u.id);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

/** Sat 24 Okt 2026, 09:00 WIB */
const NOW = new Date('2026-10-24T02:00:00Z');

async function setup(tx: Tx, userId: string) {
	const c = await createClient(tx, clientSchema.parse({ name: 'ZZ AI Klien' }), userId);
	const d = await createDeal(
		tx,
		dealSchema.parse({
			clientId: c.id,
			title: 'Dashboard produksi',
			stage: 'proposal',
			valueEstimate: 75_000_000,
			firstStepTitle: 'Follow up proposal',
			firstStepDue: '2026-10-20T10:00'
		}),
		userId
	);
	return { clientId: c.id, dealId: d.id };
}

/** A fake model that records what it was asked and answers with `answer` */
function fakeAi(answer: unknown) {
	const calls: AiRequest[] = [];
	const complete: AiComplete = async (req) => {
		calls.push(req);
		return { json: answer, model: 'fake-model', usage: { input: 100, output: 50 } };
	};
	return { complete, calls };
}

const suggestion = (fields: Record<string, unknown>) => ({
	kind: 'risk',
	target_id: null,
	insight: 'Proposal sudah dikirim tetapi belum ada tindak lanjut.',
	proposed_action: 'Telepon PIC untuk menanyakan keputusan proposal',
	proposed_due_at: '2026-10-26T10:00',
	...fields
});

describe.skipIf(!isDevDb)('AI suggestions (dev database, fake model)', { timeout: 120_000 }, () => {
	it('builds a context whose hash only changes when the facts change', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, dealId } = await setup(tx, userId);
			const a = await buildClientContext(tx, clientId);
			expect(a.facts.deal_terbuka).toHaveLength(1);
			expect(a.facts.deal_terbuka[0]).toMatchObject({
				id: dealId,
				judul: 'Dashboard produksi',
				tahap: 'Proposal Terkirim',
				nilai_rp: 75_000_000,
				langkah_terbuka: [{ judul: 'Follow up proposal', jatuh_tempo: '2026-10-20 10:00' }]
			});
			expect((await buildClientContext(tx, clientId)).hash).toBe(a.hash);
			await addAction(
				tx,
				{ dealId },
				stepSchema.parse({ title: 'Kirim revisi', dueDate: '2026-10-28', dueTime: '14:00' }),
				userId
			);
			expect((await buildClientContext(tx, clientId)).hash).not.toBe(a.hash);
			expect(await activeClientIds(tx)).toContain(clientId);
		});
	});

	it('stores valid suggestions, drops wrong targets and impossible times, and skips unchanged clients', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, dealId } = await setup(tx, userId);
			const ai = fakeAi({
				suggestions: [
					suggestion({ target_id: dealId }),
					suggestion({
						kind: 'opportunity',
						target_id: 'bukan-id',
						proposed_due_at: '2026-10-01T10:00'
					}),
					suggestion({ kind: 'pipeline', proposed_due_at: 'besok pagi' })
				]
			});
			const first = await generateSuggestions(tx, clientId, { complete: ai.complete, now: NOW });
			expect(first).toMatchObject({ status: 'created', count: 3, model: 'fake-model' });
			expect(ai.calls[0].user).toContain('Sabtu, 2026-10-24 09:00 WIB');
			expect(ai.calls[0].user).toContain(dealId);

			const rows = await listOpenSuggestions(tx, { clientId });
			const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
			expect(byKind.risk).toMatchObject({ dealId, cardTitle: 'Dashboard produksi' });
			expect(byKind.risk.proposedDueAt?.toISOString()).toBe('2026-10-26T03:00:00.000Z');
			expect([byKind.opportunity.dealId, byKind.opportunity.proposedDueAt]).toEqual([null, null]);
			expect(byKind.pipeline.proposedDueAt).toBeNull();

			// nothing changed: no second call
			const again = await generateSuggestions(tx, clientId, { complete: ai.complete, now: NOW });
			expect([again.status, ai.calls.length]).toEqual(['skipped', 1]);

			// forced: asks again and the earlier open ones are replaced
			const ai2 = fakeAi({ suggestions: [suggestion({ target_id: dealId })] });
			await generateSuggestions(tx, clientId, { complete: ai2.complete, now: NOW, force: true });
			expect(await listOpenSuggestions(tx, { clientId })).toHaveLength(1);
			expect(ai2.calls[0].user).toContain('saran_terbuka');
		});
	});

	it('stores nothing when the model answers outside the schema', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId } = await setup(tx, userId);
			const bad = fakeAi({ suggestions: [{ kind: 'gossip', insight: 'x' }] });
			await expect(
				generateSuggestions(tx, clientId, { complete: bad.complete, now: NOW })
			).rejects.toThrow(/does not match the schema/);
			expect(await listOpenSuggestions(tx, { clientId })).toEqual([]);
			const [c] = await tx
				.select({ hash: client.aiInputHash })
				.from(client)
				.where(eq(client.id, clientId));
			expect(c.hash).toBeNull(); // the next run tries again
		});
	});

	it('accepting creates a step at the proposed WIB time, once, and logs it', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, dealId } = await setup(tx, userId);
			await generateSuggestions(tx, clientId, {
				complete: fakeAi({
					suggestions: [suggestion({ target_id: dealId }), suggestion({ kind: 'pipeline' })]
				}).complete,
				now: NOW
			});
			const open = await listOpenSuggestions(tx, { clientId });
			const risk = open.find((s) => s.kind === 'risk')!;
			const general = open.find((s) => s.kind === 'pipeline')!;

			const step = await acceptSuggestion(tx, risk.id, {}, userId, NOW);
			expect([step.title, step.dueAt.toISOString(), step.dealId]).toEqual([
				'Telepon PIC untuk menanyakan keputusan proposal',
				'2026-10-26T03:00:00.000Z',
				dealId
			]);
			const [saved] = await tx
				.select({ from: action.fromSuggestionId })
				.from(action)
				.where(eq(action.id, step.id));
			expect(saved.from).toBe(risk.id);
			const [logged] = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.clientId, clientId), eq(activity.type, 'ai_accepted')));
			expect(logged.body).toBe(
				'Saran AI diterima: Telepon PIC untuk menanyakan keputusan proposal'
			);
			const fieldOf = (p: Promise<unknown>) =>
				p.then(
					() => null,
					(e) => (e instanceof ServiceError ? (e.field ?? e.message) : String(e))
				);
			expect(await fieldOf(acceptSuggestion(tx, risk.id, {}, userId, NOW))).toBe(
				'Saran ini sudah diputuskan.'
			);

			// a general suggestion needs a card; with one it works, with an edited title and time
			expect(await fieldOf(acceptSuggestion(tx, general.id, {}, userId, NOW))).toBe('target');
			const edited = await acceptSuggestion(
				tx,
				general.id,
				{ target: { dealId }, title: 'Rapikan tahap deal', dueAt: '2026-10-27T15:30' },
				userId,
				NOW
			);
			expect([edited.title, edited.dueAt.toISOString()]).toEqual([
				'Rapikan tahap deal',
				'2026-10-27T08:30:00.000Z'
			]);
		});
	});

	it('dismisses with a timeline entry and expires untouched ones after 7 days', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, dealId } = await setup(tx, userId);
			await generateSuggestions(tx, clientId, {
				complete: fakeAi({
					suggestions: [suggestion({ target_id: dealId }), suggestion({ kind: 'opportunity' })]
				}).complete,
				now: NOW
			});
			const [first, second] = await listOpenSuggestions(tx, { clientId });
			await dismissSuggestion(tx, first.id, userId, NOW);
			const [row] = await tx.select().from(aiSuggestion).where(eq(aiSuggestion.id, first.id));
			expect([row.status, row.decidedBy]).toEqual(['dismissed', userId]);
			const logs = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.clientId, clientId), eq(activity.type, 'system')));
			expect(logs.map((l) => l.body)).toContain(`Saran AI diabaikan: ${first.proposedAction}`);

			await tx
				.update(aiSuggestion)
				.set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
				.where(eq(aiSuggestion.id, second.id));
			expect(await expireSuggestions(tx)).toBeGreaterThanOrEqual(1);
			expect(await listOpenSuggestions(tx, { clientId })).toEqual([]);
		});
	});
});
