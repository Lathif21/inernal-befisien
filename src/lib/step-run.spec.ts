import { describe, expect, it } from 'vitest';
import { laterOpenStages, parseStepAction, runProblem } from './step-run';

const DEAL = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

describe('parseStepAction (the AI writes the action after the step title)', () => {
	it('reads each action with its known values', () => {
		expect(parseStepAction('profil; industri=logistics; kota=Surabaya; konteks=Butuh ERP')).toEqual(
			{
				kind: 'update_client',
				industry: 'logistics',
				source: undefined,
				city: 'Surabaya',
				website: undefined,
				notes: undefined,
				context: 'Butuh ERP'
			}
		);
		expect(
			parseStepAction('deal_baru; judul=Integrasi ERP; nilai=150.000.000; layanan=integration')
		).toEqual({
			kind: 'create_deal',
			title: 'Integrasi ERP',
			value: 150_000_000,
			serviceType: 'integration'
		});
		expect(parseStepAction(` pindah_deal; deal=${DEAL}; tahap=proposal`)).toEqual({
			kind: 'move_deal',
			dealId: DEAL,
			to: 'proposal'
		});
		expect(parseStepAction('bayar_invoice; invoice=INV/2026/10/003')).toEqual({
			kind: 'record_payment',
			invoiceNumber: 'INV/2026/10/003',
			amount: null
		});
	});

	it('"profil" alone is enough: the team fills it in at Jalankan', () => {
		expect(parseStepAction('profil')).toMatchObject({ kind: 'update_client', industry: undefined });
	});

	it('drops values outside the lists, and actions it cannot run', () => {
		expect(parseStepAction('profil; industri=retail')).toMatchObject({ industry: undefined });
		// Won / Lost stay manual; a move needs the deal
		expect(parseStepAction(`pindah_deal; deal=${DEAL}; tahap=won`)).toBeNull();
		expect(parseStepAction('pindah_deal; tahap=proposal')).toBeNull();
		expect(parseStepAction('bayar_invoice; jumlah=5000000')).toBeNull();
		expect(parseStepAction('kirim_email; ke=pak andi')).toBeNull();
	});
});

describe('runProblem', () => {
	const next = null;
	it('names the first thing missing before Simpan', () => {
		expect(
			runProblem({
				kind: 'create_deal',
				title: '',
				valueEstimate: null,
				serviceType: '',
				firstStepTitle: 'Hubungi PIC',
				firstStepDue: '2026-11-02T10:00',
				next
			})
		).toBe('Judul deal minimal 3 karakter.');
		expect(
			runProblem({
				kind: 'move_deal',
				dealId: DEAL,
				to: 'proposal',
				next: { title: 'x', due: '2026-11-02T10:00' }
			})
		).toBe('Tulis langkah berikutnya (min. 3 karakter).');
		expect(
			runProblem({ kind: 'record_payment', invoiceId: DEAL, amount: 0, date: '2026-11-02', next })
		).toBe('Jumlah harus lebih dari 0.');
	});

	it('passes a complete run', () => {
		expect(runProblem({ kind: 'move_deal', dealId: DEAL, to: 'negotiation', next })).toBeNull();
	});
});

it('laterOpenStages: only forward, never Won / Lost', () => {
	expect(laterOpenStages('meeting')).toEqual(['proposal', 'negotiation']);
	expect(laterOpenStages('negotiation')).toEqual([]);
});
