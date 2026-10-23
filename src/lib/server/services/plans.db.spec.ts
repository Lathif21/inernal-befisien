// Database tests for Strategi (plans, attention, schedule, badge). Neon `dev` or localhost, rolled back.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { wibLocalToDate } from '../../format';
import { createDb, type Tx } from '../db/client';
import { action, strategyPlan, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema, moveSchema, wonProjectSchema } from '../../schemas/deal';
import { planSchema } from '../../schemas/plan';
import { stepSchema } from '../../schemas/step';
import { completeAction, listCardSteps } from './actions';
import { createClient } from './clients';
import { createDeal, moveDeal } from './deals';
import {
	addPlanStep,
	attentionCount,
	attentionSteps,
	createPlan,
	firstOpenPage,
	listPlans,
	moveStep,
	planStepsPage,
	scheduleSteps,
	setPlanStatus
} from './plans';

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

const step = (title: string, dueDate: string, dueTime = '10:00') =>
	stepSchema.parse({ title, dueDate, dueTime });

/** A unique client with a deal (first step far in the future) and a plan on it */
async function setup(tx: Tx, userId: string, name = 'ZZ Strategi Uji') {
	const c = await createClient(tx, clientSchema.parse({ name }), userId);
	const d = await createDeal(
		tx,
		dealSchema.parse({
			clientId: c.id,
			title: `Deal ${name}`,
			firstStepTitle: 'Langkah awal deal',
			firstStepDue: '2031-01-01T10:00'
		}),
		userId
	);
	const plan = await createPlan(
		tx,
		planSchema.parse({ card: `deal:${d.id}`, goal: `Tujuan ${name}` }),
		userId
	);
	return { clientId: c.id, dealId: d.id, planId: plan.id };
}

describe.skipIf(!isDevDb)('strategy service (dev database)', { timeout: 90_000 }, () => {
	it('keeps plan steps in order, appends the "next" step, and reorders', async () => {
		await inRollback(async (tx, userId) => {
			const { planId } = await setup(tx, userId);
			const s1 = await addPlanStep(tx, planId, step('Satu', '2030-05-01'), userId);
			await addPlanStep(tx, planId, step('Dua', '2030-04-01'), userId); // earlier date, still second
			await addPlanStep(tx, planId, step('Tiga', '2030-06-01'), userId);
			const order = async () => (await planStepsPage(tx, planId, 1)).steps.map((s) => s.title);
			expect(await order()).toEqual(['Satu', 'Dua', 'Tiga']);

			// completing with a next step puts it at the end of the plan, not the top
			await completeAction(tx, s1.id, { next: step('Empat', '2030-07-01') }, userId);
			expect(await order()).toEqual(['Satu', 'Dua', 'Tiga', 'Empat']);

			const tiga = (await planStepsPage(tx, planId, 1)).steps.find((s) => s.title === 'Tiga')!;
			await moveStep(tx, tiga.id, 'up');
			expect(await order()).toEqual(['Satu', 'Tiga', 'Dua', 'Empat']);
		});
	});

	it('opens each plan card on the page with its first unfinished step', async () => {
		expect(firstOpenPage([{ doneAt: new Date() }, { doneAt: null }])).toBe(1);
		expect(
			firstOpenPage(Array.from({ length: 5 }, (_, i) => ({ doneAt: i < 4 ? new Date() : null })))
		).toBe(2);
		expect(firstOpenPage([{ doneAt: new Date() }])).toBe(1);

		await inRollback(async (tx, userId) => {
			const { planId } = await setup(tx, userId, 'ZZ Strategi Halaman');
			const ids: string[] = [];
			for (let i = 1; i <= 6; i++)
				ids.push((await addPlanStep(tx, planId, step(`Langkah ${i}`, `2030-0${i}-01`), userId)).id);
			// L1–L4 done (the card still has L5, L6 and the deal's own step open)
			for (const id of ids.slice(0, 4)) await completeAction(tx, id, {}, userId);

			const { plans } = await listPlans(tx, { q: 'ZZ Strategi Halaman' });
			expect(plans).toHaveLength(1);
			expect(plans[0]).toMatchObject({ totalSteps: 6, doneSteps: 4, stepPage: 2 });
			expect(plans[0].steps.map((s) => s.title)).toEqual(['Langkah 5', 'Langkah 6']);
			expect((await planStepsPage(tx, planId, 1)).steps.map((s) => s.title)).toEqual([
				'Langkah 1',
				'Langkah 2',
				'Langkah 3',
				'Langkah 4'
			]);
		});
	});

	it('moves the plan to the new project when the deal is won; steps follow the project', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, planId } = await setup(tx, userId, 'ZZ Strategi Menang');
			const { projectId } = await moveDeal(
				tx,
				moveSchema.parse({ id: dealId, to: 'won', createProject: 'yes' }),
				wonProjectSchema.parse({
					projectName: 'Proyek ZZ',
					contractValue: 1_000_000,
					startDate: '2030-01-01',
					firstStepTitle: 'Kick-off',
					firstStepDue: '2030-01-02T10:00'
				}),
				userId
			);
			const [plan] = await tx.select().from(strategyPlan).where(eq(strategyPlan.id, planId));
			expect(plan).toMatchObject({ projectId, dealId });
			const added = await addPlanStep(tx, planId, step('Setelah menang', '2030-02-01'), userId);
			expect(added).toMatchObject({ projectId, dealId: null });
			expect(
				(await listCardSteps(tx, { projectId: projectId! })).open.map((s) => s.title)
			).toContain('Setelah menang');
		});
	});

	it('lists late and today steps, counts the badge, and filters the schedule', async () => {
		await inRollback(async (tx, userId) => {
			const { dealId, planId } = await setup(tx, userId, 'ZZ Strategi Perhatian');
			const now = wibLocalToDate('2030-03-10T12:00')!; // 12:00 WIB
			const at = (s: string) => wibLocalToDate(s)!;
			const mk = (title: string, due: string, assigneeId: string | null = userId) =>
				tx
					.insert(action)
					.values({ dealId, planId, title, dueAt: at(due), assigneeId })
					.returning();
			await mk('Terlambat kemarin', '2030-03-09T10:00');
			await mk('Pagi tadi', '2030-03-10T08:00');
			await mk('Sore ini', '2030-03-10T16:00');
			await mk('Besok pagi', '2030-03-11T09:00');
			await mk('Orang lain hari ini', '2030-03-10T15:00', null);

			const attention = await attentionSteps(tx, { q: 'ZZ Strategi Perhatian' }, now);
			expect(attention.map((s) => s.title)).toEqual([
				'Terlambat kemarin',
				'Pagi tadi',
				'Orang lain hari ini',
				'Sore ini'
			]);
			const mine = await attentionSteps(tx, { q: 'ZZ Strategi Perhatian', mineOf: userId }, now);
			expect(mine.map((s) => s.title)).not.toContain('Orang lain hari ini');
			expect(mine[0].cardOpenSteps).toBeGreaterThanOrEqual(5);

			// the badge counts every client, so compare with and without this test's steps
			const badge = await attentionCount(tx, userId, now);
			expect(badge).toBeGreaterThanOrEqual(3);

			const week = await scheduleSteps(tx, at('2030-03-09T00:00'), at('2030-03-16T00:00'), {
				q: 'perhatian'
			});
			expect(week.map((s) => s.title)).toEqual([
				'Terlambat kemarin',
				'Pagi tadi',
				'Orang lain hari ini',
				'Sore ini',
				'Besok pagi'
			]);
			const search = await scheduleSteps(tx, at('2030-03-09T00:00'), at('2030-03-16T00:00'), {
				q: 'besok pagi'
			});
			expect(search.map((s) => s.title)).toEqual(['Besok pagi']);
		});
	});

	it('hides achieved / dropped plans from the list and filters by owner', async () => {
		await inRollback(async (tx, userId) => {
			const { planId } = await setup(tx, userId, 'ZZ Strategi Status');
			expect((await listPlans(tx, { q: 'ZZ Strategi Status', mineOf: userId })).total).toBe(1);
			expect((await listPlans(tx, { q: 'ZZ Strategi Status', mineOf: 'someone-else' })).total).toBe(
				0
			);
			await setPlanStatus(tx, planId, 'achieved', userId);
			expect((await listPlans(tx, { q: 'ZZ Strategi Status' })).total).toBe(0);
		});
	});
});
