// Executable plan steps (P2-13): Jalankan prepares a run, Simpan writes it and ticks the step off.
// Rolled-back transaction on the Neon `dev` branch or localhost only.
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { action, activity, client, deal, invoice, user } from '../db/schema/index';
import { clientSchema } from '../../schemas/client';
import { dealSchema } from '../../schemas/deal';
import { invoiceSchema } from '../../schemas/invoice';
import { planSchema } from '../../schemas/plan';
import { stepSchema } from '../../schemas/step';
import type { RunDraft, StepPayload } from '../../step-run';
import { completeAction } from './actions';
import { getClientContext } from './client-context';
import { createClient } from './clients';
import { createDeal } from './deals';
import { ServiceError } from './errors';
import { createInvoice, markInvoiceSent } from './invoices';
import { addPlanStep, createPlan } from './plans';
import { executeStepRun, listRunnableSteps, prepareStepRun } from './step-runs';

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

// Monday 26 Oct 2026 09:00 WIB
const now = new Date('2026-10-26T02:00:00Z');

type Ctx = { tx: Tx; userId: string; clientId: string; dealId: string; planId: string };

async function inRollback(fn: (c: Ctx) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			const c = await createClient(
				tx,
				clientSchema.parse({ name: 'PT ZZ Jalankan', source: 'event' }),
				u.id
			);
			const d = await createDeal(
				tx,
				dealSchema.parse({
					clientId: c.id,
					title: 'Dashboard gudang',
					stage: 'meeting',
					valueEstimate: 80_000_000,
					firstStepTitle: 'Telepon PIC',
					firstStepDue: '2026-10-27T10:00'
				}),
				u.id
			);
			const plan = await createPlan(
				tx,
				planSchema.parse({ card: `deal:${d.id}`, goal: 'Closing dashboard gudang' }),
				u.id
			);
			await fn({ tx, userId: u.id, clientId: c.id, dealId: d.id, planId: plan.id });
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

const errorOf = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(e) => (e instanceof ServiceError ? e.message : String(e))
	);

const step = (title: string, due = '2026-10-28') =>
	stepSchema.parse({ title, dueDate: due, dueTime: '10:00' });

async function addRun(c: Ctx, title: string, payload: StepPayload | null) {
	return addPlanStep(c.tx, c.planId, step(title), c.userId, payload);
}

describe.skipIf(!isDevDb)('executable plan steps (dev database)', { timeout: 120_000 }, () => {
	it('fills in the client profile, only the changed fields, and the Ringkasan konteks', () =>
		inRollback(async (c) => {
			const s = await addRun(c, 'Lengkapi profil klien', {
				kind: 'update_client',
				industry: 'logistics'
			});
			expect(s.kind).toBe('update_client');
			expect((await listRunnableSteps(c.tx, c.clientId)).map((r) => r.id)).toEqual([s.id]);

			const { run, view } = await prepareStepRun(c.tx, s.id, now);
			expect(view).toMatchObject({ clientName: 'PT ZZ Jalankan', needsNext: false });
			expect(run).toMatchObject({
				kind: 'update_client',
				industry: 'logistics',
				source: 'event',
				base: { industry: '', source: 'event', city: '' }
			});

			// Someone fills in the website meanwhile: Simpan must not clear it
			await c.tx
				.update(client)
				.set({ website: 'https://zz.example' })
				.where(eq(client.id, c.clientId));
			const edited = { ...run, city: 'Surabaya', contextAdd: 'Butuh ERP gudang untuk 3 cabang.' };
			const done = await executeStepRun(c.tx, s.id, edited, c.userId);
			expect(done.line).toBe(
				'Profil PT ZZ Jalankan: industri, kota diperbarui, Ringkasan konteks ditambah.'
			);
			const [row] = await c.tx.select().from(client).where(eq(client.id, c.clientId));
			expect(row).toMatchObject({
				industry: 'logistics',
				city: 'Surabaya',
				source: 'event',
				website: 'https://zz.example'
			});
			expect((await getClientContext(c.tx, c.clientId))?.summary).toBe(
				'Butuh ERP gudang untuk 3 cabang.'
			);
			const [after] = await c.tx.select().from(action).where(eq(action.id, s.id));
			expect(after.doneAt).not.toBeNull();
			const logged = await c.tx
				.select({ body: activity.body })
				.from(activity)
				.where(and(eq(activity.clientId, c.clientId), eq(activity.type, 'action_done')));
			expect(logged.map((a) => a.body)).toContain('Lengkapi profil klien');

			// A second Simpan (double tap, two tabs) does nothing
			expect(await errorOf(executeStepRun(c.tx, s.id, edited, c.userId))).toBe(
				'Langkah ini sudah selesai.'
			);
		}));

	it('moves a deal forward, and refuses a move that is already done', () =>
		inRollback(async (c) => {
			const a = await addRun(c, 'Pindahkan deal ke Proposal', {
				kind: 'move_deal',
				dealId: c.dealId,
				to: 'proposal'
			});
			const b = await addRun(c, 'Pindahkan lagi ke Proposal', {
				kind: 'move_deal',
				dealId: c.dealId,
				to: 'proposal'
			});
			const { run, view } = await prepareStepRun(c.tx, a.id, now);
			expect(view).toMatchObject({ dealTitle: 'Dashboard gudang', dealStage: 'meeting' });
			expect((await executeStepRun(c.tx, a.id, run, c.userId)).line).toBe(
				'Deal "Dashboard gudang" pindah ke Proposal Terkirim.'
			);
			const [d] = await c.tx.select().from(deal).where(eq(deal.id, c.dealId));
			expect(d.stage).toBe('proposal');
			expect(await errorOf(prepareStepRun(c.tx, b.id, now))).toMatch(
				/sudah di tahap Proposal Terkirim\. Langkah ini tidak perlu dijalankan/
			);
		}));

	it('creates a deal with its first step, once per title', () =>
		inRollback(async (c) => {
			const s = await addRun(c, 'Buka deal integrasi', {
				kind: 'create_deal',
				title: 'Integrasi ERP',
				value: 150_000_000,
				serviceType: 'integration'
			});
			const { run } = await prepareStepRun(c.tx, s.id, now);
			// Tuesday 10:00, the next working day
			expect(run).toMatchObject({ title: 'Integrasi ERP', firstStepDue: '2026-10-27T10:00' });
			const twin = await addRun(c, 'Buka deal integrasi lagi', {
				kind: 'create_deal',
				title: 'integrasi erp'
			});
			expect((await executeStepRun(c.tx, s.id, run, c.userId)).line).toBe(
				'Deal "Integrasi ERP" dibuat di tahap Lead.'
			);
			const [created] = await c.tx
				.select()
				.from(deal)
				.where(and(eq(deal.clientId, c.clientId), eq(deal.title, 'Integrasi ERP')));
			expect(created).toMatchObject({ stage: 'lead', valueEstimate: 150_000_000 });
			const open = await c.tx
				.select()
				.from(action)
				.where(and(eq(action.dealId, created.id), isNull(action.doneAt)));
			expect(open.map((o) => o.title)).toEqual(['Hubungi PIC untuk membahas kebutuhan']);
			const second = await prepareStepRun(c.tx, twin.id, now);
			expect(await errorOf(executeStepRun(c.tx, twin.id, second.run, c.userId))).toBe(
				'Deal "integrasi erp" sudah ada untuk klien ini.'
			);
		}));

	it('records a payment up to the balance, and refuses a paid invoice', () =>
		inRollback(async (c) => {
			const inv = await createInvoice(
				c.tx,
				invoiceSchema.parse({
					clientId: c.clientId,
					issueDate: '2099-01-15',
					dueDate: '2099-01-29',
					pph23Rate: 0,
					items: [{ description: 'Termin 1', qty: 1, unitPrice: 20_000_000 }]
				}),
				c.userId
			);
			const s = await addRun(c, 'Catat pembayaran termin 1', {
				kind: 'record_payment',
				invoiceNumber: inv.number
			});
			expect(await errorOf(prepareStepRun(c.tx, s.id, now))).toBe(
				`Invoice ${inv.number} belum ditandai terkirim.`
			);
			await markInvoiceSent(c.tx, inv.id, c.userId);
			const { run, view } = await prepareStepRun(c.tx, s.id, now);
			const total = (await c.tx.select().from(invoice).where(eq(invoice.id, inv.id)))[0].total;
			expect(view).toMatchObject({ invoiceNumber: inv.number, remaining: total });
			expect(run).toMatchObject({ amount: total, date: '2026-10-26', method: 'transfer' });

			expect(
				await errorOf(executeStepRun(c.tx, s.id, { ...run, amount: total + 1 }, c.userId))
			).toMatch(/Jumlah melebihi sisa tagihan/);
			const done = await executeStepRun(c.tx, s.id, run, c.userId);
			expect(done.line).toMatch(/^Pembayaran Rp.* dicatat \(Lunas\)\.$/);

			const again = await addRun(c, 'Catat pembayaran lagi', {
				kind: 'record_payment',
				invoiceNumber: inv.number
			});
			expect(await errorOf(prepareStepRun(c.tx, again.id, now))).toBe(
				`Invoice ${inv.number} sudah lunas.`
			);
		}));

	it('asks for the next step when it is the card’s last open step; reminders do not run', () =>
		inRollback(async (c) => {
			const s = await addRun(c, 'Pindahkan deal ke Proposal', {
				kind: 'move_deal',
				dealId: c.dealId,
				to: 'proposal'
			});
			const reminder = await addRun(c, 'Kirim proposal ke PIC', null);
			expect(await errorOf(prepareStepRun(c.tx, reminder.id, now))).toBe(
				'Langkah ini pengingat; tidak ada yang dijalankan di sistem.'
			);
			// Leave only the action step open
			for (const open of await c.tx
				.select({ id: action.id })
				.from(action)
				.where(and(eq(action.dealId, c.dealId), isNull(action.doneAt))))
				if (open.id !== s.id) await completeAction(c.tx, open.id, {}, c.userId);

			const { run, view } = await prepareStepRun(c.tx, s.id, now);
			expect(view.needsNext).toBe(true);
			expect(run.next).toEqual({
				title: 'Tindak lanjut Dashboard gudang',
				due: '2026-10-28T10:00'
			});
			const withoutNext: RunDraft = { ...run, next: null };
			expect(await errorOf(executeStepRun(c.tx, s.id, withoutNext, c.userId))).toBe(
				'Ini langkah terakhir. Tambahkan langkah berikutnya.'
			);
			await executeStepRun(c.tx, s.id, run, c.userId);
			const open = await c.tx
				.select({ title: action.title })
				.from(action)
				.where(and(eq(action.dealId, c.dealId), isNull(action.doneAt)));
			expect(open.map((o) => o.title)).toEqual(['Tindak lanjut Dashboard gudang']);
		}));
});
