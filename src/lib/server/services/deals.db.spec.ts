// Database tests for the Sales Pipeline service. Neon `dev` branch (or localhost) only, inside a
// transaction that is always rolled back.
import { and, asc, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import {
	action,
	activity,
	client,
	deal,
	project,
	strategyPlan,
	transaction,
	user
} from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema, moveSchema, wonProjectSchema } from '../../schemas/deal';
import { stepSchema } from '../../schemas/step';
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

async function setup(tx: Tx, userId: string, titles: string[], stage = 'lead') {
	const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Test Pipeline' }), userId);
	const ids: string[] = [];
	for (const title of titles) {
		const d = await createDeal(
			tx,
			dealSchema.parse({
				clientId: c.id,
				title: `Deal ${title}`,
				stage,
				valueEstimate: 10_000_000,
				firstStepTitle: 'Langkah pertama',
				firstStepDue: '2030-01-10T10:00'
			}),
			userId
		);
		ids.push(d.id);
	}
	return { clientId: c.id, ids };
}

/** Titles of the test client's deals in one column, in board order */
async function column(tx: Tx, clientId: string, stage: 'lead' | 'proposal' | 'won' | 'lost') {
	const rows = await tx
		.select({ title: deal.title })
		.from(deal)
		.where(and(eq(deal.clientId, clientId), eq(deal.stage, stage)))
		.orderBy(asc(deal.position), asc(deal.id));
	return rows.map((r) => r.title.replace(/^Deal /, ''));
}

const move = (fields: Record<string, unknown>) => moveSchema.parse(fields);

describe.skipIf(!isDevDb)('deals service (dev database)', { timeout: 60_000 }, () => {
	it('keeps the dropped order between neighbours across columns and within one', async () => {
		await inRollback(async (tx, userId) => {
			// new deals go to the top of their column: C, B, A
			const { clientId, ids } = await setup(tx, userId, ['A', 'B', 'C']);
			const [a, b, c] = ids;
			expect(await column(tx, clientId, 'lead')).toEqual(['C', 'B', 'A']);

			// drag A between C and B
			await moveDeal(tx, move({ id: a, to: 'lead', beforeId: c, afterId: b }), null, userId);
			expect(await column(tx, clientId, 'lead')).toEqual(['C', 'A', 'B']);

			// B to Proposal (empty column), then C below it
			await moveDeal(tx, move({ id: b, to: 'proposal' }), null, userId);
			await moveDeal(tx, move({ id: c, to: 'proposal', beforeId: b }), null, userId);
			expect(await column(tx, clientId, 'proposal')).toEqual(['B', 'C']);
			// A above B
			await moveDeal(tx, move({ id: a, to: 'proposal', afterId: b }), null, userId);
			expect(await column(tx, clientId, 'proposal')).toEqual(['A', 'B', 'C']);

			// a stage change is logged with from / to; a reorder is not
			const log = await tx
				.select({ body: activity.body, meta: activity.meta })
				.from(activity)
				.where(and(eq(activity.dealId, b), eq(activity.type, 'stage_change')));
			expect(log).toHaveLength(1);
			expect(log[0].meta).toEqual({ from: 'lead', to: 'proposal' });
		});
	});

	it('falls back to the bottom when the neighbours are stale', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, ids } = await setup(tx, userId, ['A', 'B']);
			// "afterId" points at a card that is no longer in Lead
			await moveDeal(tx, move({ id: ids[1], to: 'proposal' }), null, userId);
			await moveDeal(
				tx,
				move({ id: ids[0], to: 'proposal', beforeId: ids[1], afterId: ids[1] }),
				null,
				userId
			);
			expect(await column(tx, clientId, 'proposal')).toEqual(['B', 'A']);
		});
	});

	it('requires a lost reason, then closes open steps and drops the active plan', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, ids } = await setup(tx, userId, ['Kalah']);
			expect(() => move({ id: ids[0], to: 'lost' })).toThrow(); // schema
			await expect(
				// inside a savepoint: a failed statement would abort the whole test transaction
				tx.transaction((sp) => sp.update(deal).set({ stage: 'lost' }).where(eq(deal.id, ids[0])))
			).rejects.toThrow(); // database check constraint

			const [plan] = await tx
				.insert(strategyPlan)
				.values({ clientId, dealId: ids[0], goal: 'Closing', ownerId: userId })
				.returning();
			await moveDeal(tx, move({ id: ids[0], to: 'lost', lostReason: 'Harga' }), null, userId);

			const [d] = await tx.select().from(deal).where(eq(deal.id, ids[0]));
			expect(d).toMatchObject({ stage: 'lost', lostReason: 'Harga', probability: 0 });
			expect(d.lostAt).toBeInstanceOf(Date);
			const open = await tx
				.select()
				.from(action)
				.where(and(eq(action.dealId, ids[0]), isNull(action.doneAt)));
			expect(open).toHaveLength(0);
			const [p] = await tx.select().from(strategyPlan).where(eq(strategyPlan.id, plan.id));
			expect(p.status).toBe('dropped');
		});
	});

	it('creates a linked project when won, moves the plan, activates the client and locks the deal', async () => {
		await inRollback(async (tx, userId) => {
			const { clientId, ids } = await setup(tx, userId, ['Menang']);
			const [plan] = await tx
				.insert(strategyPlan)
				.values({ clientId, dealId: ids[0], goal: 'Closing', ownerId: userId })
				.returning();
			const wonProject = wonProjectSchema.parse({
				projectName: 'Proyek Menang',
				contractValue: 12_000_000,
				startDate: '2030-01-15',
				firstStepTitle: 'Kick-off meeting',
				firstStepDue: '2030-01-18T10:00'
			});
			const { projectId } = await moveDeal(
				tx,
				move({ id: ids[0], to: 'won', createProject: 'yes' }),
				wonProject,
				userId
			);
			expect(projectId).toBeTruthy();

			const [p] = await tx.select().from(project).where(eq(project.id, projectId!));
			expect(p).toMatchObject({
				dealId: ids[0],
				clientId,
				stage: 'onboarding',
				contractValue: 12_000_000
			});
			const steps = await tx.select().from(action).where(eq(action.projectId, projectId!));
			expect(steps.map((s) => s.title)).toEqual(['Kick-off meeting']);
			expect(steps[0].dueAt.toISOString()).toBe('2030-01-18T03:00:00.000Z'); // 10:00 WIB
			const [c] = await tx
				.select({ status: client.status })
				.from(client)
				.where(eq(client.id, clientId));
			expect(c.status).toBe('active');
			const [movedPlan] = await tx.select().from(strategyPlan).where(eq(strategyPlan.id, plan.id));
			expect(movedPlan).toMatchObject({ projectId, dealId: ids[0] });

			// back out of Deal ✓ (human error): only with confirmation, and not once money is attached
			const fieldOf = (p: Promise<unknown>) =>
				p.then(
					() => null,
					(e) => (e instanceof ServiceError ? (e.field ?? e.message) : String(e))
				);
			expect(
				await fieldOf(moveDeal(tx, move({ id: ids[0], to: 'negotiation' }), null, userId))
			).toBe('dropProject');
			const [txn] = await tx
				.insert(transaction)
				.values({
					type: 'income',
					date: '2030-01-20',
					amount: 1_000_000,
					clientId,
					projectId
				})
				.returning();
			const back = move({ id: ids[0], to: 'negotiation', dropProject: 'yes' });
			expect(await fieldOf(moveDeal(tx, back, null, userId))).toMatch(
				/sudah punya 1 transaksi, jadi tidak bisa dihapus/
			);
			await tx.delete(transaction).where(eq(transaction.id, txn.id));

			await moveDeal(tx, back, null, userId);
			const [d] = await tx.select().from(deal).where(eq(deal.id, ids[0]));
			expect(d).toMatchObject({ stage: 'negotiation', wonAt: null });
			expect(await tx.select().from(project).where(eq(project.id, projectId!))).toHaveLength(0);
			expect(await tx.select().from(action).where(eq(action.projectId, projectId!))).toHaveLength(
				0
			);
			const [returned] = await tx.select().from(strategyPlan).where(eq(strategyPlan.id, plan.id));
			expect(returned).toMatchObject({ projectId: null, dealId: ids[0] });
			const logs = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(eq(activity.dealId, ids[0]));
			expect(logs.map((l) => l.body)).toContain(
				'Proyek "Proyek Menang" dihapus karena deal "Deal Menang" dipindah dari Deal ✓'
			);
		});
	});

	it('reopens a lost deal only with a next step', async () => {
		await inRollback(async (tx, userId) => {
			const { ids } = await setup(tx, userId, ['Batal keliru']);
			await moveDeal(tx, move({ id: ids[0], to: 'lost', lostReason: 'Harga' }), null, userId);
			await expect(
				moveDeal(tx, move({ id: ids[0], to: 'proposal' }), null, userId)
			).rejects.toMatchObject({ field: 'next' });
			const next = stepSchema.parse({
				title: 'Telepon ulang klien',
				dueDate: '2030-02-03',
				dueTime: '10:00'
			});
			await moveDeal(tx, move({ id: ids[0], to: 'proposal' }), null, userId, next);
			const [d] = await tx.select().from(deal).where(eq(deal.id, ids[0]));
			expect(d).toMatchObject({ stage: 'proposal', lostReason: null, lostAt: null });
			const open = await tx
				.select({ title: action.title })
				.from(action)
				.where(and(eq(action.dealId, ids[0]), isNull(action.doneAt)));
			expect(open.map((o) => o.title)).toEqual(['Telepon ulang klien']);
		});
	});

	it('"Nanti saja": won without a project can still move back', async () => {
		await inRollback(async (tx, userId) => {
			const { ids } = await setup(tx, userId, ['Nanti']);
			const r = await moveDeal(tx, move({ id: ids[0], to: 'won' }), null, userId);
			expect(r.projectId).toBeNull();
			await moveDeal(tx, move({ id: ids[0], to: 'negotiation' }), null, userId);
			const [d] = await tx.select().from(deal).where(eq(deal.id, ids[0]));
			expect(d).toMatchObject({ stage: 'negotiation', wonAt: null, probability: 80 });
		});
	});
});
