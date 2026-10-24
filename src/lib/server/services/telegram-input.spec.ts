// Telegram input (P2-10): AI answer → draft, and the preview text. No database.
import { describe, expect, it } from 'vitest';
import { INPUT_SCHEMA, type InputAnswer } from '../ai/prompts/telegram-input';
import { draftPreview, stepLine, toDraft, type InputContext } from './telegram-input';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

// Saturday 24 Oct 2026 09:00 WIB
const now = new Date('2026-10-24T02:00:00Z');
const ctx: InputContext = {
	now,
	clients: [{ ref: 'K1', id: CLIENT, name: 'PT Sinar Jaya Abadi' }],
	cards: [
		{
			ref: 'D1',
			kind: 'deal',
			id: DEAL,
			clientId: CLIENT,
			clientName: 'PT Sinar Jaya Abadi',
			title: 'Website company profile',
			stage: 'proposal'
		},
		{
			ref: 'P1',
			kind: 'project',
			id: PROJECT,
			clientId: CLIENT,
			clientName: 'PT Sinar Jaya Abadi',
			title: 'Dashboard produksi',
			stage: 'in_progress'
		}
	]
};

/** An answer with every field empty, like the strict schema returns */
const answer = (fields: Partial<InputAnswer>): InputAnswer => ({
	...(Object.fromEntries(
		Object.keys(INPUT_SCHEMA.properties).map((k) => [k, ''])
	) as unknown as InputAnswer),
	intent: 'unknown',
	revises_previous: false,
	plan_steps: [],
	...fields
});

describe('toDraft', () => {
	it('lead: CSV columns, checked like the import, with the default first step', () => {
		const r = toDraft(
			answer({
				intent: 'lead',
				client_name: 'CV Maju Bersama',
				city: 'Malang',
				industry: 'logistics',
				contact_name: 'Budi',
				contact_phone: '0812-3456-7890',
				deal_title: 'Integrasi gudang',
				service_type: 'integration',
				deal_value: '25000000'
			}),
			ctx
		);
		expect(r.ok).toBe(true);
		if (!r.ok || r.draft.kind !== 'lead') return;
		expect(r.draft.existingClientId).toBeNull();
		expect(r.draft.row.deal).toMatchObject({
			title: 'Integrasi gudang',
			stage: 'lead',
			value: 25_000_000,
			nextAction: { title: 'Hubungi klien', due: '2026-10-25T10:00' }
		});
		const text = draftPreview(r.draft);
		expect(text).toContain('Lead baru');
		expect(text).toContain('klien baru · Malang · Logistik');
		expect(text).toContain('Rp 25.000.000');
		expect(text).toContain('+62 812-3456-7890');
		expect(text).toContain('Hubungi klien, Minggu, 25 Okt 2026 10:00 WIB');
	});

	it('lead: an existing client is matched by name and keeps its spelling', () => {
		const r = toDraft(
			answer({
				intent: 'lead',
				client_name: 'pt sinar jaya abadi',
				contact_name: 'Rina',
				contact_email: 'RINA@sinar.co.id'
			}),
			ctx
		);
		expect(r).toMatchObject({
			ok: true,
			draft: {
				existingClientId: CLIENT,
				row: { clientName: 'PT Sinar Jaya Abadi', contact: { email: 'rina@sinar.co.id' } }
			}
		});
	});

	it('lead: the import errors come back in Indonesian', () => {
		const r = toDraft(
			answer({
				intent: 'lead',
				client_name: 'CV Maju',
				deal_title: 'We',
				deal_value: 'dua puluh'
			}),
			ctx
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.problems.join(' ')).toMatch(/deal_value "dua puluh" harus angka/);
		expect(r.problems.join(' ')).toMatch(/deal_title minimal 3 karakter/);
	});

	it('lead: an existing client with nothing new is refused', () => {
		const r = toDraft(answer({ intent: 'lead', existing_client: CLIENT }), ctx);
		expect(r).toMatchObject({ ok: false, problems: [expect.stringMatching(/sudah ada di CRM/)] });
	});

	it('step: needs a card and a time; a date alone means 09:00', () => {
		expect(toDraft(answer({ intent: 'step', step_title: 'Telepon Budi' }), ctx)).toMatchObject({
			ok: false,
			problems: [expect.stringMatching(/Deal atau proyek mana/), expect.stringMatching(/Kapan/)]
		});
		const r = toDraft(
			answer({
				intent: 'step',
				target: PROJECT,
				step_title: 'Demo dashboard',
				step_due: '2026-10-27'
			}),
			ctx
		);
		expect(r).toMatchObject({
			ok: true,
			draft: { kind: 'step', card: { id: PROJECT }, step: { due: '2026-10-27T09:00' } }
		});
		if (r.ok) expect(draftPreview(r.draft)).toContain('Proyek <b>Dashboard produksi</b>');
	});

	it('step: a time in the past is a warning, not an error', () => {
		const r = toDraft(
			answer({
				intent: 'step',
				target: DEAL,
				step_title: 'Kirim proposal',
				step_due: '2026-10-23T10:00'
			}),
			ctx
		);
		expect(r).toMatchObject({
			ok: true,
			draft: { warnings: ['Waktu "Kirim proposal" sudah lewat.'] }
		});
	});

	it('move: deals only, a real change, and lost needs a reason', () => {
		expect(toDraft(answer({ intent: 'move', target: PROJECT, to_stage: 'won' }), ctx).ok).toBe(
			false
		);
		expect(
			toDraft(answer({ intent: 'move', target: DEAL, to_stage: 'proposal' }), ctx)
		).toMatchObject({
			ok: false,
			problems: [expect.stringMatching(/sudah di tahap Proposal Terkirim/)]
		});
		expect(toDraft(answer({ intent: 'move', target: DEAL, to_stage: 'lost' }), ctx)).toMatchObject({
			ok: false,
			problems: [expect.stringMatching(/Alasan wajib/)]
		});
		const r = toDraft(
			answer({ intent: 'move', target: DEAL, to_stage: 'lost', lost_reason: 'Harga' }),
			ctx
		);
		expect(r).toMatchObject({ ok: true, draft: { kind: 'move', to: 'lost', lostReason: 'Harga' } });
	});

	it('plan: goal, target date and dated steps', () => {
		const r = toDraft(
			answer({
				intent: 'plan',
				target: DEAL,
				plan_goal: 'Closing bulan ini',
				plan_target_date: '2026-10-31',
				plan_steps: ['2026-10-26T09:00 | Kirim revisi proposal', '2026-10-28T10:00 | Meeting harga']
			}),
			ctx
		);
		expect(r).toMatchObject({ ok: true, draft: { kind: 'plan', targetDate: '2026-10-31' } });
		if (!r.ok) return;
		const text = draftPreview(r.draft);
		expect(text).toContain('Tujuan: <b>Closing bulan ini</b>');
		expect(text).toContain('• Meeting harga, Rabu, 28 Okt 2026 10:00 WIB');
	});

	it('plan step lines: the asked format, or a date anywhere in the text', () => {
		expect(stepLine('2026-10-26T10:00 | Kirim build UAT')).toEqual({
			due: '2026-10-26T10:00',
			title: 'Kirim build UAT'
		});
		// What MiniMax sent before the format was asked for
		expect(stepLine('Lakukan meeting review pada 2026-10-28T10:00')).toEqual({
			due: '2026-10-28T10:00',
			title: 'Lakukan meeting review'
		});
		expect(stepLine('Perbaiki bug')).toEqual({ due: '', title: 'Perbaiki bug' });
		const r = toDraft(
			answer({ intent: 'plan', target: DEAL, plan_goal: 'Closing', plan_steps: ['Perbaiki bug'] }),
			ctx
		);
		expect(r).toMatchObject({
			ok: false,
			problems: [expect.stringMatching(/Kapan "Perbaiki bug"/)]
		});
	});

	it('note: on a client or on a card; unknown types become a note', () => {
		expect(
			toDraft(
				answer({ intent: 'note', target: CLIENT, note_type: 'call', note_body: 'Minta diskon' }),
				ctx
			)
		).toMatchObject({ ok: true, draft: { clientId: CLIENT, card: null, type: 'call' } });
		expect(
			toDraft(
				answer({ intent: 'note', target: DEAL, note_type: 'fax', note_body: 'Revisi <b>' }),
				ctx
			)
		).toMatchObject({ ok: true, draft: { clientId: CLIENT, card: { id: DEAL }, type: 'note' } });
	});

	it('unknown ids and intents give no draft', () => {
		expect(toDraft(answer({ intent: 'unknown', reply: 'Halo' }), ctx)).toEqual({
			ok: false,
			problems: []
		});
		expect(
			toDraft(answer({ intent: 'note', target: 'K1', note_body: 'ref, not an id' }), ctx).ok
		).toBe(false);
	});
});

describe('draftPreview', () => {
	it('escapes HTML from the message', () => {
		const r = toDraft(
			answer({ intent: 'note', target: CLIENT, note_body: 'Harga <10 juta & cepat' }),
			ctx
		);
		if (!r.ok) throw new Error('expected a draft');
		expect(draftPreview(r.draft)).toContain('Harga &lt;10 juta &amp; cepat');
	});
});
