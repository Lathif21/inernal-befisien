// Database tests for the Project Delivery service. Neon `dev` branch (or localhost) only, inside a
// transaction that is always rolled back.
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { action, activity, deal, project, transaction, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema, moveSchema, wonProjectSchema } from '../../schemas/deal';
import { projectMoveSchema, projectSchema } from '../../schemas/project';
import { stepSchema } from '../../schemas/step';
import { completeAction } from './actions';
import { createClient } from './clients';
import { createDeal, moveDeal } from './deals';
import { ServiceError } from './errors';
import {
	deleteProject,
	getProjectDetail,
	listBoardProjects,
	moveProject,
	updateProject
} from './projects';

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

/** Won deals with a project each, all in Onboarding; returns the project ids in creation order */
async function setup(tx: Tx, userId: string, names: string[]) {
	const c = await createClient(tx, clientSchema.parse({ name: 'ZZ Test Proyek' }), userId);
	const ids: string[] = [];
	for (const name of names) {
		const d = await createDeal(
			tx,
			dealSchema.parse({
				clientId: c.id,
				title: `Deal ${name}`,
				stage: 'negotiation',
				valueEstimate: 100_000_000,
				firstStepTitle: 'Langkah pertama',
				firstStepDue: '2030-01-10T10:00'
			}),
			userId
		);
		const { projectId } = await moveDeal(
			tx,
			moveSchema.parse({ id: d.id, to: 'won', createProject: 'yes' }),
			wonProjectSchema.parse({
				projectName: `Proyek ${name}`,
				contractValue: 100_000_000,
				startDate: '2030-01-01',
				firstStepTitle: 'Kick-off meeting',
				firstStepDue: '2030-01-04T10:00'
			}),
			userId
		);
		ids.push(projectId!);
	}
	return { clientId: c.id, ids };
}

async function column(tx: Tx, clientId: string, stage: 'onboarding' | 'in_progress') {
	const rows = await tx
		.select({ name: project.name })
		.from(project)
		.where(and(eq(project.clientId, clientId), eq(project.stage, stage)))
		.orderBy(asc(project.position), asc(project.id));
	return rows.map((r) => r.name.replace(/^Proyek /, ''));
}

const move = (fields: Record<string, unknown>) => projectMoveSchema.parse(fields);
const stateOf = async (tx: Tx, id: string) =>
	(
		await tx
			.select({ stage: project.stage, finishedAt: project.finishedAt })
			.from(project)
			.where(eq(project.id, id))
	)[0];

describe.skipIf(!isDevDb)('projects service (dev database)', { timeout: 90_000 }, () => {
	it('moves across stages with an activity and keeps the dropped order', async () => {
		await inRollback(async (tx, userId) => {
			// new projects go to the top of Onboarding: C, B, A
			const { clientId, ids } = await setup(tx, userId, ['A', 'B', 'C']);
			const [a, b, c] = ids;
			expect(await column(tx, clientId, 'onboarding')).toEqual(['C', 'B', 'A']);

			await moveProject(tx, move({ id: a, to: 'in_progress' }), userId);
			await moveProject(tx, move({ id: c, to: 'in_progress', beforeId: a }), userId);
			await moveProject(tx, move({ id: b, to: 'in_progress', beforeId: a, afterId: c }), userId);
			expect(await column(tx, clientId, 'in_progress')).toEqual(['A', 'B', 'C']);
			const logged = await tx
				.select({ body: activity.body, meta: activity.meta })
				.from(activity)
				.where(and(eq(activity.projectId, a), eq(activity.type, 'stage_change')));
			expect(logged).toEqual([
				{
					body: 'Proyek "Proyek A" pindah dari Onboarding ke Dikerjakan',
					meta: { from: 'onboarding', to: 'in_progress' }
				}
			]);
		});
	});

	it('stamps finished_at on Selesai, keeps it in Maintenance and clears it when reopened', async () => {
		await inRollback(async (tx, userId) => {
			const {
				ids: [id]
			} = await setup(tx, userId, ['A']);
			await moveProject(tx, move({ id, to: 'done' }), userId);
			const done = await stateOf(tx, id);
			expect(done.finishedAt).toBeInstanceOf(Date);
			await moveProject(tx, move({ id, to: 'maintenance' }), userId);
			expect((await stateOf(tx, id)).finishedAt).toEqual(done.finishedAt);
			await moveProject(tx, move({ id, to: 'in_progress' }), userId);
			expect(await stateOf(tx, id)).toEqual({ stage: 'in_progress', finishedAt: null });
		});
	});

	it('counts only paid income towards payment progress', async () => {
		await inRollback(async (tx, userId) => {
			const {
				clientId,
				ids: [id]
			} = await setup(tx, userId, ['A']);
			const row = (type: 'income' | 'expense', status: 'paid' | 'planned', amount: number) => ({
				type,
				status,
				amount,
				date: '2030-01-05',
				clientId,
				projectId: id
			});
			await tx
				.insert(transaction)
				.values([
					row('income', 'paid', 30_000_000),
					row('income', 'paid', 12_500_000),
					row('income', 'planned', 40_000_000),
					row('expense', 'paid', 7_000_000)
				]);
			const card = (await listBoardProjects(tx, { q: 'ZZ Test Proyek' })).find((p) => p.id === id)!;
			expect(card.paid).toBe(42_500_000);
			expect(card.contractValue).toBe(100_000_000);
			expect(card.next?.title).toBe('Kick-off meeting');
			expect((await getProjectDetail(tx, id))!.paid).toBe(42_500_000);
		});
	});

	it('keeps Selesai on the board for 30 days only', async () => {
		await inRollback(async (tx, userId) => {
			const { ids } = await setup(tx, userId, ['A', 'B']);
			for (const id of ids) await moveProject(tx, move({ id, to: 'done' }), userId);
			await tx
				.update(project)
				.set({ stageChangedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
				.where(eq(project.id, ids[0]));
			const onBoard = (await listBoardProjects(tx, { q: 'ZZ Test Proyek' })).map((p) => p.id);
			expect(onBoard).toEqual([ids[1]]);
		});
	});

	it('moves the project to its next stage after a step, but not past Selesai', async () => {
		await inRollback(async (tx, userId) => {
			const {
				ids: [id]
			} = await setup(tx, userId, ['A']);
			const [kickoff] = await tx
				.select({ id: action.id })
				.from(action)
				.where(eq(action.projectId, id));
			await completeAction(
				tx,
				kickoff.id,
				{
					next: stepSchema.parse({
						title: 'Kumpulkan akses sistem',
						dueDate: '2030-01-08',
						dueTime: '09:00'
					}),
					moveToNextStage: true
				},
				userId
			);
			expect((await stateOf(tx, id)).stage).toBe('in_progress');

			await moveProject(tx, move({ id, to: 'done' }), userId);
			const [open] = await tx
				.select({ id: action.id })
				.from(action)
				.where(eq(action.projectId, id));
			await expect(completeAction(tx, open.id, { moveToNextStage: true }, userId)).rejects.toThrow(
				ServiceError
			);
		});
	});

	it('edits the details and validates the dates', async () => {
		await inRollback(async (tx, userId) => {
			const {
				ids: [id]
			} = await setup(tx, userId, ['A']);
			const input = {
				id,
				name: 'Proyek A v2',
				serviceType: 'integration',
				contractValue: 120_000_000,
				startDate: '2030-01-01',
				targetEndDate: '2030-03-31',
				ownerId: ''
			};
			await updateProject(tx, projectSchema.parse(input), userId);
			const d = (await getProjectDetail(tx, id))!;
			expect([d.name, d.contractValue, d.targetEndDate, d.dealTitle]).toEqual([
				'Proyek A v2',
				120_000_000,
				'2030-03-31',
				'Deal A'
			]);
			expect(projectSchema.safeParse({ ...input, targetEndDate: '2029-12-31' }).success).toBe(
				false
			);
		});
	});

	it('deletes a project without money records; its deal stays won', async () => {
		await inRollback(async (tx, userId) => {
			const {
				clientId,
				ids: [kept, dropped]
			} = await setup(tx, userId, ['Dibayar', 'Salah']);
			await tx.insert(transaction).values({
				type: 'income',
				status: 'paid',
				amount: 10_000_000,
				date: '2030-01-05',
				clientId,
				projectId: kept
			});
			const err = await deleteProject(tx, kept, userId).catch((e) => e);
			expect(err).toBeInstanceOf(ServiceError);
			expect(err.message).toContain('1 transaksi');

			const [{ dealId }] = await tx
				.select({ dealId: project.dealId })
				.from(project)
				.where(eq(project.id, dropped));
			await deleteProject(tx, dropped, userId);
			expect(await tx.select().from(project).where(eq(project.id, dropped))).toHaveLength(0);
			expect(await tx.select().from(action).where(eq(action.projectId, dropped))).toHaveLength(0);
			const [d] = await tx.select({ stage: deal.stage }).from(deal).where(eq(deal.id, dealId!));
			expect(d.stage).toBe('won');
			const log = await tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.dealId, dealId!), eq(activity.type, 'system')));
			expect(log.map((l) => l.body)).toContain('Proyek dihapus: Proyek Salah');
		});
	});
});
