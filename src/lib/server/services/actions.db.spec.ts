// Database tests for steps (rule 4). Neon `dev` branch (or localhost) only, rolled back.
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { activity, deal, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema, moveSchema } from '../../schemas/deal';
import { stepSchema } from '../../schemas/step';
import {
	addAction,
	completeAction,
	deleteAction,
	getNextActions,
	listCardSteps,
	updateAction
} from './actions';
import { createClient } from './clients';
import { createDeal, moveDeal } from './deals';
import { ServiceError } from './errors';

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

/** A deal in Lead whose only open step is "Langkah pertama" (2030-01-10 10:00 WIB) */
async function dealWithOneStep(tx: Tx, userId: string) {
	const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Test Langkah' }), userId);
	const d = await createDeal(
		tx,
		dealSchema.parse({
			clientId: c.id,
			title: 'Deal langkah',
			firstStepTitle: 'Langkah pertama',
			firstStepDue: '2030-01-10T10:00'
		}),
		userId
	);
	const steps = await listCardSteps(tx, { dealId: d.id });
	return { dealId: d.id, firstStepId: steps.open[0].id };
}

const step = (fields: Record<string, unknown>) => stepSchema.parse(fields);

describe.skipIf(!isDevDb)('steps service (dev database)', { timeout: 60_000 }, () => {
	it('shows the earliest open step as the next action', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId } = await dealWithOneStep(tx, userId);
			await addAction(
				tx,
				{ dealId },
				step({ title: 'Lebih awal', dueDate: '2030-01-05', dueTime: '09:00' }),
				userId
			);
			await addAction(
				tx,
				{ dealId },
				step({ title: 'Lebih akhir', dueDate: '2030-02-01', dueTime: '09:00' }),
				userId
			);
			const next = (await getNextActions(tx, { dealIds: [dealId] })).get(dealId);
			expect(next?.title).toBe('Lebih awal');
			expect(next?.dueAt.toISOString()).toBe('2030-01-05T02:00:00.000Z'); // 09:00 WIB
		});
	});

	it('stores all-day steps at 00:00 WIB and reschedules', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, firstStepId } = await dealWithOneStep(tx, userId);
			const allDay = await addAction(
				tx,
				{ dealId },
				step({ title: 'Seharian', dueDate: '2030-01-01', allDay: 'on' }),
				userId
			);
			expect(allDay).toMatchObject({ allDay: true });
			expect(allDay.dueAt.toISOString()).toBe('2029-12-31T17:00:00.000Z');

			await updateAction(
				tx,
				firstStepId,
				step({ title: 'Dijadwal ulang', dueDate: '2029-12-30', dueTime: '08:00' }),
				userId
			);
			expect((await getNextActions(tx, { dealIds: [dealId] })).get(dealId)?.title).toBe(
				'Dijadwal ulang'
			);
		});
	});

	it('refuses to complete the last step of an active deal without a next step', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, firstStepId } = await dealWithOneStep(tx, userId);
			const err = await completeAction(tx, firstStepId, {}, userId).catch((e) => e);
			expect(err).toBeInstanceOf(ServiceError);
			expect(err.field).toBe('next');

			const { open } = await completeAction(
				tx,
				firstStepId,
				{ next: step({ title: 'Langkah kedua', dueDate: '2030-01-12', dueTime: '14:00' }) },
				userId
			);
			expect(open).toBe(1);
			const steps = await listCardSteps(tx, { dealId });
			expect(steps.open.map((s) => s.title)).toEqual(['Langkah kedua']);
			expect(steps.done.map((s) => s.title)).toEqual(['Langkah pertama']);
			const done = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.dealId, dealId), eq(activity.type, 'action_done')));
			expect(done.map((d) => d.body)).toEqual(['Langkah pertama']);
		});
	});

	it('completes a non-last step freely and can move the deal to the next stage', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, firstStepId } = await dealWithOneStep(tx, userId);
			await addAction(
				tx,
				{ dealId },
				step({ title: 'Cadangan', dueDate: '2030-03-01', dueTime: '10:00' }),
				userId
			);
			const { open } = await completeAction(tx, firstStepId, { moveToNextStage: true }, userId);
			expect(open).toBe(1);
			const [d] = await tx.select({ stage: deal.stage }).from(deal).where(eq(deal.id, dealId));
			expect(d.stage).toBe('contacted');
		});
	});

	it('lets won / lost cards finish their last step without a next one', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, firstStepId } = await dealWithOneStep(tx, userId);
			await moveDeal(tx, moveSchema.parse({ id: dealId, to: 'won' }), null, userId);
			const { open } = await completeAction(tx, firstStepId, {}, userId);
			expect(open).toBe(0);
		});
	});

	it('deletes a step, but keeps the only open step of an active card', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, firstStepId } = await dealWithOneStep(tx, userId);
			const err = await deleteAction(tx, firstStepId, userId).catch((e) => e);
			expect(err).toBeInstanceOf(ServiceError);

			const second = await addAction(
				tx,
				{ dealId },
				step({ title: 'Salah input', dueDate: '2030-01-11', dueTime: '09:00' }),
				userId
			);
			await deleteAction(tx, second.id, userId);
			// done steps go freely, even the card's last one
			await completeAction(
				tx,
				firstStepId,
				{ next: step({ title: 'Langkah kedua', dueDate: '2030-01-12', dueTime: '14:00' }) },
				userId
			);
			await deleteAction(tx, firstStepId, userId);

			const steps = await listCardSteps(tx, { dealId });
			expect(steps.open.map((s) => s.title)).toEqual(['Langkah kedua']);
			expect(steps.done).toHaveLength(0);
			const logged = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.dealId, dealId), eq(activity.type, 'system')));
			expect(logged.map((l) => l.body)).toContain('Langkah dihapus: Salah input');
		});
	});
});
