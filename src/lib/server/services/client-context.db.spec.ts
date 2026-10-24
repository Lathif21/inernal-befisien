// Ringkasan konteks: built from the whole history, skipped when nothing changed, team edits kept
// as the starting point, and read by the suggestions. Fake AI; rolled-back transaction on the
// Neon `dev` branch or localhost only.
import { describe, expect, it } from 'vitest';
import type { AiComplete, AiRequest } from '../ai/client';
import { createDb, type Tx } from '../db/client';
import { deal, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { logActivity } from './activity';
import { buildClientContext } from './ai-suggestions';
import { createClient } from './clients';
import { getClientContext, refreshClientContext, saveClientContext } from './client-context';

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

/** Records every request and answers with a numbered summary */
function fakeAi() {
	const calls: AiRequest[] = [];
	const complete: AiComplete = async (req) => {
		calls.push(req);
		return {
			json: { summary: `Profil & kebutuhan:\n- ringkasan ke-${calls.length}` },
			model: 'fake-model',
			usage: { input: 100, output: 20 }
		};
	};
	return { calls, complete };
}

describe.skipIf(!isDevDb)('client context (dev database)', { timeout: 60_000 }, () => {
	it('summarises the whole history once, keeps team edits, and feeds the suggestions', async () => {
		await inRollback(async (tx, userId) => {
			const ai = fakeAi();
			const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Konteks Klien' }), userId);

			// createClient logs a creation entry; a client with only that still gets a summary
			const first = await refreshClientContext(tx, c.id, { complete: ai.complete });
			expect(first.status).toBe('updated');

			await tx.insert(deal).values({
				clientId: c.id,
				title: 'Dashboard gudang',
				stage: 'lost',
				lostReason: 'Harga: memilih vendor lokal',
				lostAt: new Date(),
				position: 'a0'
			});
			await logActivity(tx, {
				clientId: c.id,
				type: 'meeting',
				body: 'Pak Budi yang memutuskan; minta demo sebelum Desember',
				userId
			});
			const second = await refreshClientContext(tx, c.id, { complete: ai.complete });
			expect(second.status).toBe('updated');
			const sent = ai.calls[1].user;
			for (const s of ['Harga: memilih vendor lokal', 'Pak Budi yang memutuskan', 'ringkasan ke-1'])
				expect(sent).toContain(s);

			// nothing new: no AI call; force asks again
			expect((await refreshClientContext(tx, c.id, { complete: ai.complete })).status).toBe(
				'skipped'
			);
			expect(ai.calls).toHaveLength(2);
			await refreshClientContext(tx, c.id, { complete: ai.complete, force: true });
			expect(ai.calls).toHaveLength(3);

			// the team's edit is shown as theirs and is the next update's starting point
			await saveClientContext(tx, c.id, 'Orang kunci:\n- Pak Budi (direktur)', userId);
			const edited = await getClientContext(tx, c.id);
			expect(edited).toMatchObject({
				summary: 'Orang kunci:\n- Pak Budi (direktur)',
				source: 'team'
			});
			expect(edited?.updatedByName).toBeTruthy();
			await logActivity(tx, { clientId: c.id, type: 'call', body: 'Telepon follow-up', userId });
			await refreshClientContext(tx, c.id, { complete: ai.complete });
			const fourth = JSON.parse(ai.calls[3].user.slice(ai.calls[3].user.indexOf('{')));
			expect(fourth).toMatchObject({
				ringkasan_sebelumnya: 'Orang kunci:\n- Pak Budi (direktur)',
				sumber_sebelumnya: 'team'
			});
			expect((await getClientContext(tx, c.id))?.source).toBe('ai');

			// the suggestions read the summary
			const ctx = await buildClientContext(tx, c.id);
			expect(ctx.facts.ringkasan_konteks).toBe('Profil & kebutuhan:\n- ringkasan ke-4');
		});
	});
});
