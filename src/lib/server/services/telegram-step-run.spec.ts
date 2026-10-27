import { describe, expect, it } from 'vitest';
import type { RunDraft } from '../../step-run';
import { STEP_RUN_FIELDS, type StepRunField } from '../ai/prompts/step-run';
import { applyFields, fieldsOf } from './telegram-step-run';

const DEAL = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

/** The AI's answer: the run's own fields, changed by `changes`; other kinds "" */
const answer = (run: RunDraft, changes: Partial<Record<StepRunField, string>>) =>
	({
		...Object.fromEntries(STEP_RUN_FIELDS.map((f) => [f, ''])),
		...fieldsOf(run),
		...changes
	}) as Record<StepRunField, string>;

describe('a chat correction applied to a Jalankan run', () => {
	const profile: RunDraft = {
		kind: 'update_client',
		industry: '',
		source: 'event',
		city: '',
		website: '',
		notes: '',
		contextAdd: '',
		base: { industry: '', source: 'event', city: '', website: '', notes: '' },
		next: null
	};

	it('fills in the profile and keeps the base', () => {
		const run = applyFields(
			profile,
			answer(profile, {
				industry: 'logistics',
				city: 'Surabaya',
				context_add: 'Butuh ERP gudang.'
			})
		);
		expect(run).toMatchObject({
			industry: 'logistics',
			source: 'event',
			city: 'Surabaya',
			contextAdd: 'Butuh ERP gudang.',
			base: profile.kind === 'update_client' ? profile.base : {}
		});
	});

	it('keeps the old choice when the AI answers outside the list', () => {
		const run = applyFields(profile, answer(profile, { industry: 'retail' }));
		expect(run).toMatchObject({ industry: '' });
	});

	it('reads Rupiah amounts and keeps the amount when none is given', () => {
		const pay: RunDraft = {
			kind: 'record_payment',
			invoiceId: DEAL,
			amount: 20_000_000,
			date: '2026-10-27',
			method: 'transfer',
			next: { title: 'Kirim kuitansi', due: '2026-10-28T10:00' }
		};
		expect(
			applyFields(pay, answer(pay, { amount: '12.000.000', next_due: '2026-10-29 09:00' }))
		).toMatchObject({
			amount: 12_000_000,
			next: { title: 'Kirim kuitansi', due: '2026-10-29T09:00' }
		});
		expect(applyFields(pay, answer(pay, { amount: '' }))).toMatchObject({ amount: 20_000_000 });
	});

	it('moves a deal only to an open stage', () => {
		const move: RunDraft = { kind: 'move_deal', dealId: DEAL, to: 'proposal', next: null };
		expect(applyFields(move, answer(move, { to: 'negotiation' }))).toMatchObject({
			to: 'negotiation'
		});
		expect(applyFields(move, answer(move, { to: 'won' }))).toMatchObject({ to: 'proposal' });
	});
});
