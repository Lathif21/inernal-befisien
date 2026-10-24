// Telegram input (P2-10): a message or voice note → one draft the sender confirms with Simpan.
// Relative imports only: the Trigger.dev task `telegram-inbound` runs processInbound, the webhook
// runs confirmDraft / cancelDraft. Nothing is written to the CRM before Simpan, and Simpan goes
// through the same services as the app.
import { and, asc, desc, eq, gt, isNull, ne, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import {
	ACTIVITY_TYPE_LABELS,
	CLIENT_SOURCE_LABELS,
	DEAL_STAGE_META,
	DEAL_STAGES,
	INDUSTRY_LABELS,
	MANUAL_ACTIVITY_TYPES,
	PROJECT_STAGE_META,
	SERVICE_TYPE_LABELS,
	type DealStage,
	type ProjectStage
} from '../../constants';
import {
	dateID,
	dateToWibLocal,
	dayKeyWib,
	phoneDisplay,
	phoneNormalize,
	rupiah
} from '../../format';
import { parseDue, validateRow, type ImportColumn, type ImportRow } from '../../import/client-csv';
import { addDays } from '../../period';
import { moveSchema, wonProjectSchema } from '../../schemas/deal';
import { planSchema } from '../../schemas/plan';
import { stepSchema, type StepInput } from '../../schemas/step';
import type { AiComplete } from '../ai/client';
import {
	INPUT_INTENTS,
	INPUT_SCHEMA,
	INPUT_SYSTEM,
	inputUserMessage,
	type InputAnswer
} from '../ai/prompts/telegram-input';
import type { Transcribe } from '../ai/transcribe';
import type { DbOrTx, Tx } from '../db/client';
import { client, deal, project, telegramDraft, user } from '../db/schema/index';
import { escapeHtml, type TelegramButton } from '../notify/telegram';
import { addAction } from './actions';
import { logActivity } from './activity';
import { moveDeal } from './deals';
import { ServiceError } from './errors';
import { importRows } from './import';
import { addPlanStep, createPlan } from './plans';

/** A draft can be saved for this long */
export const DRAFT_MINUTES = 30;
/** Longer voice notes are refused before they are downloaded */
export const MAX_VOICE_SECONDS = 300;
/** Clients listed for the AI (the newest names beyond this are matched by exact name only) */
const MAX_CLIENTS = 400;

export const BOT_HELP = [
	'<b>Catat lewat chat atau voice note</b>',
	'Contoh:',
	'• Lead baru PT Sinar Jaya, Surabaya, kontak Pak Budi 0812-3456-7890, website company profile 25 juta, follow up Kamis jam 10',
	'• Besok jam 2 meeting demo dengan Sinar Jaya',
	'• Deal Sinar Jaya masuk negosiasi',
	'• Rencana Sinar Jaya: closing bulan ini. Langkah: kirim revisi proposal Senin, meeting harga Rabu jam 10',
	'• Catatan telepon Sinar Jaya: minta diskon 10%, keputusan minggu depan',
	'',
	'Bot menyiapkan draf dulu. Data baru tersimpan setelah Anda menekan <b>Simpan</b>. Ada yang salah? Balas dengan koreksinya.',
	'',
	'/bantuan menampilkan pesan ini, /stop memutus Telegram.'
].join('\n');

type ManualType = (typeof MANUAL_ACTIVITY_TYPES)[number];

export type CardInfo = {
	kind: 'deal' | 'project';
	id: string;
	clientId: string;
	clientName: string;
	title: string;
	stage: string;
};

/** A step as the bot keeps it: WIB wall time `yyyy-MM-ddTHH:mm` */
type StepDraft = { title: string; due: string };

export type Draft = { warnings: string[] } & (
	| { kind: 'lead'; row: ImportRow; existingClientId: string | null }
	| { kind: 'step'; card: CardInfo; step: StepDraft }
	| { kind: 'move'; card: CardInfo; to: DealStage; lostReason: string }
	| { kind: 'plan'; card: CardInfo; goal: string; targetDate: string; steps: StepDraft[] }
	| {
			kind: 'note';
			clientId: string;
			clientName: string;
			card: CardInfo | null;
			type: ManualType;
			body: string;
	  }
);

// ---------- what the AI sees ----------

export type InputContext = {
	now: Date;
	clients: { ref: string; id: string; name: string }[];
	cards: (CardInfo & { ref: string })[];
};

/** Clients not archived, open deals and projects not finished, each with a short ref (K1, D1, P1) */
export async function loadInputContext(db: DbOrTx, now = new Date()): Promise<InputContext> {
	const [clients, deals, projects] = await Promise.all([
		db
			.select({ id: client.id, name: client.name })
			.from(client)
			.where(isNull(client.archivedAt))
			.orderBy(desc(client.updatedAt))
			.limit(MAX_CLIENTS),
		db
			.select({
				id: deal.id,
				clientId: deal.clientId,
				clientName: client.name,
				title: deal.title,
				stage: deal.stage
			})
			.from(deal)
			.innerJoin(client, eq(client.id, deal.clientId))
			.where(and(isNull(client.archivedAt), notInArray(deal.stage, ['won', 'lost'])))
			.orderBy(asc(client.name), asc(deal.title)),
		db
			.select({
				id: project.id,
				clientId: project.clientId,
				clientName: client.name,
				title: project.name,
				stage: project.stage
			})
			.from(project)
			.innerJoin(client, eq(client.id, project.clientId))
			.where(and(isNull(client.archivedAt), ne(project.stage, 'done')))
			.orderBy(asc(client.name), asc(project.name))
	]);
	clients.sort((a, b) => a.name.localeCompare(b.name));
	return {
		now,
		clients: clients.map((c, i) => ({ ref: `K${i + 1}`, ...c })),
		cards: [
			...deals.map((d, i) => ({ ref: `D${i + 1}`, kind: 'deal' as const, ...d })),
			...projects.map((p, i) => ({ ref: `P${i + 1}`, kind: 'project' as const, ...p }))
		]
	};
}

const stageLabel = (c: Pick<CardInfo, 'kind' | 'stage'>) =>
	c.kind === 'deal'
		? DEAL_STAGE_META[c.stage as DealStage].label
		: PROJECT_STAGE_META[c.stage as ProjectStage].label;

function promptLines(ctx: InputContext) {
	return {
		clients: ctx.clients.map((c) => `${c.ref} | ${c.name}`),
		cards: ctx.cards.map(
			(c) =>
				`${c.ref} | ${c.clientName} | ${c.kind === 'deal' ? 'Deal' : 'Proyek'}: ${c.title} | ${stageLabel(c)}`
		)
	};
}

const ID_FIELDS = ['target', 'existing_client'] as const;

/** Swap refs and ids in `target` / `existing_client`; an unknown value becomes "" */
function swapIds(answer: InputAnswer, map: Map<string, string>): InputAnswer {
	const out = { ...answer };
	for (const f of ID_FIELDS) out[f] = map.get(answer[f].trim()) ?? '';
	return out;
}

function refMaps(ctx: InputContext) {
	const all = [...ctx.clients, ...ctx.cards];
	return {
		toId: new Map(all.map((x) => [x.ref, x.id])),
		toRef: new Map(all.map((x) => [x.id, x.ref]))
	};
}

/** "Sabtu, 24 Okt 2026 09:00 WIB (2026-10-24T09:00)" */
const nowLine = (now: Date) =>
	`${dateID(now, 'long')} ${dateID(now, 'time')} WIB (${dateToWibLocal(now)})`;

/** The AI answer, read leniently: a missing or odd field becomes "" instead of failing */
const text = z.string().catch('');
const answerSchema = z.object({
	intent: z.enum(INPUT_INTENTS).catch('unknown'),
	revises_previous: z.boolean().catch(false),
	...Object.fromEntries(
		Object.entries(INPUT_SCHEMA.properties)
			.filter(([k]) => !['intent', 'revises_previous', 'plan_steps'].includes(k))
			.map(([k]) => [k, text])
	),
	// Strings as asked; an object with title / due is turned into the same form
	plan_steps: z
		.array(
			z.union([
				z.string(),
				z.object({ title: text, due: text }).transform((s) => `${s.due} | ${s.title}`)
			])
		)
		.catch([])
});

/** Ask the AI; the answer comes back with real ids instead of refs */
export async function interpret(
	complete: AiComplete,
	ctx: InputContext,
	input: { source: 'text' | 'voice'; text: string; previous: InputAnswer | null }
) {
	const { toId, toRef } = refMaps(ctx);
	const res = await complete({
		system: INPUT_SYSTEM,
		user: inputUserMessage({
			now: nowLine(ctx.now),
			...promptLines(ctx),
			previous: input.previous ? swapIds(input.previous, toRef) : null,
			source: input.source,
			text: input.text
		}),
		schema: INPUT_SCHEMA,
		schemaName: 'draf_telegram',
		// Reasoning models (MiniMax) spend part of this before the JSON
		maxTokens: 8000
	});
	const answer = answerSchema.parse(res.json ?? {}) as InputAnswer;
	return { answer: swapIds(answer, toId), usage: res.usage };
}

// ---------- answer → draft ----------

export type DraftResult = { ok: true; draft: Draft } | { ok: false; problems: string[] };

const key = (s: string) => s.trim().toLowerCase();

/** WIB wall time `n` days from today at `time` */
const wibAt = (now: Date, days: number, time: string) => `${addDays(dayKeyWib(now), days)}T${time}`;

function dueOf(value: string, what: string): { due: string } | { error: string } {
	if (!value.trim()) return { error: `Kapan ${what}? Sebutkan tanggal dan jamnya.` };
	const r = parseDue(value.trim().slice(0, 16));
	return 'error' in r ? { error: `Tanggal ${what} "${value}" tidak bisa dibaca.` } : r;
}

const isPast = (due: string, now: Date) => due < dateToWibLocal(now);

const LINE_DATE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}[:.]\d{2})?/;

/** A plan step line "2026-10-26T10:00 | Kirim build UAT"; a date elsewhere in the text also works */
export function stepLine(line: string): { title: string; due: string } {
	const [left, ...rest] = line.split('|');
	if (rest.length && LINE_DATE.test(left))
		return { due: left.trim(), title: rest.join('|').trim() };
	const date = LINE_DATE.exec(line);
	if (!date) return { due: '', title: line.trim() };
	const title = line
		.replace(date[0], '')
		.replace(/\s*(pada|tanggal|tgl|,|-)\s*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
	return { due: date[0], title };
}

/** Check the AI answer (with ids) against the CRM rules and build the draft Simpan will write */
export function toDraft(a: InputAnswer, ctx: InputContext): DraftResult {
	const problems: string[] = [];
	const warnings: string[] = [];
	const card = ctx.cards.find((c) => c.id === a.target) ?? null;
	const steps = (items: { title: string; due: string }[], what: string) =>
		items.flatMap((s) => {
			const title = s.title.trim();
			if (title.length < 3) {
				problems.push(`Judul ${what} terlalu pendek.`);
				return [];
			}
			const due = dueOf(s.due, `"${title}"`);
			if ('error' in due) {
				problems.push(due.error);
				return [];
			}
			if (isPast(due.due, ctx.now)) warnings.push(`Waktu "${title}" sudah lewat.`);
			return [{ title: title.slice(0, 200), due: due.due }];
		});
	const needCard = () =>
		problems.push(
			'Deal atau proyek mana yang dimaksud? Sebutkan nama klien dan dealnya / proyeknya.'
		);

	switch (a.intent) {
		case 'lead': {
			const existing =
				ctx.clients.find((c) => c.id === a.existing_client) ??
				ctx.clients.find((c) => key(c.name) === key(a.client_name));
			const raw: Partial<Record<ImportColumn, string>> = {
				client_name: existing?.name ?? a.client_name,
				industry: a.industry,
				city: a.city,
				source: a.source,
				contact_name: a.contact_name,
				contact_position: a.contact_position,
				contact_phone: a.contact_phone,
				contact_email: a.contact_email,
				deal_title: a.deal_title,
				service_type: a.service_type,
				deal_stage: a.deal_title ? a.deal_stage || 'lead' : a.deal_stage,
				deal_value: a.deal_value,
				next_action: a.next_action,
				next_action_due: a.next_action_due.slice(0, 16),
				notes: a.notes
			};
			const checked = validateRow(raw);
			if (!checked.row) return { ok: false, problems: checked.errors };
			const row = checked.row;
			warnings.push(...checked.warnings);
			if (existing && !row.contact && !row.deal && !row.notes)
				return {
					ok: false,
					problems: [
						`${existing.name} sudah ada di CRM. Sebutkan kontak, deal, atau catatan barunya.`
					]
				};
			// The import's defaults, made visible in the preview
			if (row.deal && !row.deal.nextAction && row.deal.stage !== 'lost')
				row.deal.nextAction =
					row.deal.stage === 'won'
						? { title: 'Kick-off meeting', due: wibAt(ctx.now, 3, '10:00') }
						: { title: 'Hubungi klien', due: wibAt(ctx.now, 1, '10:00') };
			if (row.deal?.nextAction && isPast(row.deal.nextAction.due, ctx.now))
				warnings.push('Waktu langkah pertama sudah lewat.');
			return {
				ok: true,
				draft: { kind: 'lead', row, existingClientId: existing?.id ?? null, warnings }
			};
		}
		case 'step': {
			if (!card) needCard();
			const [step] = steps([{ title: a.step_title, due: a.step_due }], 'langkah');
			if (problems.length || !card || !step) return { ok: false, problems };
			return { ok: true, draft: { kind: 'step', card, step, warnings } };
		}
		case 'move': {
			if (!card || card.kind !== 'deal') {
				problems.push('Deal mana yang pindah tahap? Sebutkan nama klien dan dealnya.');
				return { ok: false, problems };
			}
			const to = (DEAL_STAGES as readonly string[]).includes(a.to_stage)
				? (a.to_stage as DealStage)
				: null;
			if (!to) problems.push('Pindah ke tahap apa?');
			else if (to === card.stage)
				problems.push(`${card.title} sudah di tahap ${DEAL_STAGE_META[to].label}.`);
			const lostReason = a.lost_reason.trim();
			if (to === 'lost' && lostReason.length < 3)
				problems.push('Kenapa batal? Alasan wajib diisi.');
			if (problems.length || !to) return { ok: false, problems };
			return {
				ok: true,
				draft: { kind: 'move', card, to, lostReason: to === 'lost' ? lostReason : '', warnings }
			};
		}
		case 'plan': {
			if (!card) needCard();
			const goal = a.plan_goal.trim();
			if (goal.length < 5) problems.push('Apa tujuan rencananya?');
			const targetDate = /^\d{4}-\d{2}-\d{2}/.test(a.plan_target_date)
				? a.plan_target_date.slice(0, 10)
				: '';
			const planSteps = steps(a.plan_steps.map(stepLine), 'langkah');
			if (problems.length || !card) return { ok: false, problems };
			return {
				ok: true,
				draft: {
					kind: 'plan',
					card,
					goal: goal.slice(0, 200),
					targetDate,
					steps: planSteps,
					warnings
				}
			};
		}
		case 'note': {
			const target = ctx.clients.find((c) => c.id === a.target);
			const clientId = target?.id ?? card?.clientId;
			const clientName = target?.name ?? card?.clientName;
			if (!clientId || !clientName) problems.push('Catatan ini untuk klien mana?');
			const body = a.note_body.trim();
			if (body.length < 2) problems.push('Isi catatannya kosong.');
			if (problems.length || !clientId || !clientName) return { ok: false, problems };
			const type = (MANUAL_ACTIVITY_TYPES as readonly string[]).includes(a.note_type)
				? (a.note_type as ManualType)
				: 'note';
			return {
				ok: true,
				draft: {
					kind: 'note',
					clientId,
					clientName,
					card,
					type,
					body: body.slice(0, 5000),
					warnings
				}
			};
		}
		default:
			return { ok: false, problems };
	}
}

// ---------- messages ----------

const esc = escapeHtml;

/** "Kamis, 30 Okt 2026 10:00 WIB" from a WIB wall time */
function whenText(due: string) {
	const [day, time] = due.split('T');
	return `${dateID(day, 'long')} ${time} WIB`;
}

const cardLine = (c: CardInfo) =>
	`${esc(c.clientName)} · ${c.kind === 'deal' ? 'Deal' : 'Proyek'} <b>${esc(c.title)}</b> (${esc(stageLabel(c))})`;

const DRAFT_TITLES: Record<Draft['kind'], string> = {
	lead: 'Lead baru',
	step: 'Langkah baru',
	move: 'Pindah tahap',
	plan: 'Rencana baru',
	note: 'Catatan'
};

/** The draft as Telegram HTML (only <b>, <i>, <a>) */
export function draftPreview(d: Draft) {
	const lines: string[] = [];
	switch (d.kind) {
		case 'lead': {
			const r = d.row;
			const facts = d.existingClientId
				? ['klien lama']
				: [
						'klien baru',
						r.city,
						r.industry && INDUSTRY_LABELS[r.industry],
						r.source && `sumber ${CLIENT_SOURCE_LABELS[r.source]}`
					].filter(Boolean);
			lines.push(
				`<b>${d.existingClientId ? 'Data klien' : DRAFT_TITLES.lead}</b>`,
				`Klien: <b>${esc(r.clientName)}</b> (${esc(facts.join(' · '))})`
			);
			if (r.contact) {
				const phone = phoneNormalize(r.contact.phone);
				lines.push(
					`Kontak: ${esc(
						[r.contact.name, r.contact.position, phone && phoneDisplay(phone), r.contact.email]
							.filter(Boolean)
							.join(' · ')
					)}`
				);
			}
			if (r.deal) {
				lines.push(
					`Deal: <b>${esc(r.deal.title)}</b> · ${esc(
						[
							DEAL_STAGE_META[r.deal.stage].label,
							r.deal.serviceType && SERVICE_TYPE_LABELS[r.deal.serviceType],
							r.deal.value !== null && rupiah(r.deal.value)
						]
							.filter(Boolean)
							.join(' · ')
					)}`
				);
				if (r.deal.nextAction)
					lines.push(
						`${r.deal.stage === 'won' ? 'Langkah pertama proyek' : 'Langkah pertama'}: ${esc(r.deal.nextAction.title)}, ${esc(whenText(r.deal.nextAction.due))}`
					);
				if (r.deal.stage === 'won') lines.push('<i>Deal menang: proyeknya ikut dibuat.</i>');
			}
			if (r.notes)
				lines.push(`${d.existingClientId ? 'Catatan (ke timeline)' : 'Catatan'}: ${esc(r.notes)}`);
			break;
		}
		case 'step':
			lines.push(
				`<b>${DRAFT_TITLES.step}</b>`,
				cardLine(d.card),
				`Langkah: <b>${esc(d.step.title)}</b>`,
				`Waktu: ${esc(whenText(d.step.due))}`
			);
			break;
		case 'move':
			lines.push(
				`<b>${DRAFT_TITLES.move}</b>`,
				cardLine(d.card),
				`Pindah ke: <b>${esc(DEAL_STAGE_META[d.to].label)}</b>`
			);
			if (d.to === 'lost') lines.push(`Alasan: ${esc(d.lostReason)}`);
			if (d.to === 'won')
				lines.push(
					'<i>Proyeknya ikut dibuat (Onboarding, nilai kontrak = nilai deal, kick-off 3 hari lagi). Ubah detailnya di Proyek.</i>'
				);
			break;
		case 'plan':
			lines.push(`<b>${DRAFT_TITLES.plan}</b>`, cardLine(d.card), `Tujuan: <b>${esc(d.goal)}</b>`);
			if (d.targetDate) lines.push(`Target: ${esc(dateID(d.targetDate, 'long'))}`);
			if (d.steps.length) {
				lines.push('Langkah:');
				for (const s of d.steps) lines.push(`• ${esc(s.title)}, ${esc(whenText(s.due))}`);
			} else lines.push('<i>Belum ada langkah; tambahkan di Strategi.</i>');
			break;
		case 'note':
			lines.push(
				`<b>${esc(ACTIVITY_TYPE_LABELS[d.type])}</b>`,
				d.card ? cardLine(d.card) : `Klien: <b>${esc(d.clientName)}</b>`,
				esc(d.body)
			);
			break;
	}
	for (const w of d.warnings) lines.push(`<i>Perhatian: ${esc(w)}</i>`);
	return lines.join('\n');
}

const quote = (source: 'text' | 'voice', input: string) =>
	source === 'voice'
		? `<i>Voice note: "${esc(input.length > 600 ? `${input.slice(0, 600)}…` : input)}"</i>\n\n`
		: '';

// ---------- the task: message → draft ----------

export type InboundPayload = {
	chatId: string;
	userId: string;
	text?: string;
	voice?: { fileId: string; duration: number };
};

export type InboundDeps = {
	complete: AiComplete;
	transcribe: Transcribe;
	download: (fileId: string) => Promise<{ data: Blob; name: string }>;
	/** Send to the payload's chat; returns the message id */
	send: (html: string, buttons?: TelegramButton[]) => Promise<number>;
	clearButtons: (messageId: number) => Promise<void>;
};

export type InboundResult =
	| { status: 'not-linked' | 'empty' }
	| { status: 'unclear'; problems: string[] }
	| { status: 'draft'; draftId: string; kind: Draft['kind']; replaced: boolean };

/** The open draft of this chat, if any (the newest pending one that has not expired) */
async function openDraft(db: DbOrTx, chatId: string, now: Date) {
	const [row] = await db
		.select()
		.from(telegramDraft)
		.where(
			and(
				eq(telegramDraft.chatId, chatId),
				eq(telegramDraft.status, 'pending'),
				gt(telegramDraft.expiresAt, now)
			)
		)
		.orderBy(desc(telegramDraft.createdAt))
		.limit(1);
	return row ?? null;
}

export async function processInbound(
	db: DbOrTx,
	payload: InboundPayload,
	deps: InboundDeps,
	now = new Date()
): Promise<InboundResult> {
	const [sender] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.id, payload.userId), eq(user.telegramChatId, payload.chatId)));
	if (!sender) return { status: 'not-linked' };

	const source = payload.voice ? 'voice' : 'text';
	let input = payload.text?.trim() ?? '';
	if (payload.voice) {
		const file = await deps.download(payload.voice.fileId);
		input = await deps.transcribe(file.data, file.name);
	}
	if (!input) {
		await deps.send('Voice note tidak terdengar jelas. Coba kirim ulang atau ketik pesannya.');
		return { status: 'empty' };
	}

	const [ctx, previous] = await Promise.all([
		loadInputContext(db, now),
		openDraft(db, payload.chatId, now)
	]);
	const { answer } = await interpret(deps.complete, ctx, {
		source,
		text: input,
		previous: (previous?.answer as InputAnswer | undefined) ?? null
	});
	const result = toDraft(answer, ctx);

	if (!result.ok) {
		const problems = result.problems;
		const lines = [answer.reply.trim(), ...problems.map((p) => `• ${p}`)].filter(Boolean);
		await deps.send(
			quote(source, input) +
				(lines.length
					? `${lines.map(esc).join('\n')}\n\nKirim ulang dengan data yang lebih lengkap.`
					: 'Pesan ini tidak berisi data untuk dicatat. Kirim /bantuan untuk contoh.')
		);
		return { status: 'unclear', problems };
	}

	const replaced = !!(answer.revises_previous && previous);
	if (replaced && previous) {
		await db
			.update(telegramDraft)
			.set({ status: 'replaced', decidedAt: now })
			.where(and(eq(telegramDraft.id, previous.id), eq(telegramDraft.status, 'pending')));
		if (previous.messageId)
			await deps.clearButtons(previous.messageId).catch(() => {
				// the old buttons stay; tapping them answers "sudah diganti"
			});
	}

	const [row] = await db
		.insert(telegramDraft)
		.values({
			userId: payload.userId,
			chatId: payload.chatId,
			kind: result.draft.kind,
			payload: result.draft as unknown as Record<string, unknown>,
			answer: answer as unknown as Record<string, unknown>,
			source,
			input,
			expiresAt: new Date(now.getTime() + DRAFT_MINUTES * 60_000)
		})
		.returning({ id: telegramDraft.id });

	const messageId = await deps.send(
		`${quote(source, input)}${draftPreview(result.draft)}\n\n<i>Periksa lalu tekan Simpan (berlaku ${DRAFT_MINUTES} menit). Ada yang salah? Balas dengan koreksinya.</i>`,
		[
			{ text: 'Simpan', data: `s:${row.id}` },
			{ text: 'Batal', data: `c:${row.id}` }
		]
	);
	await db.update(telegramDraft).set({ messageId }).where(eq(telegramDraft.id, row.id));
	return { status: 'draft', draftId: row.id, kind: result.draft.kind, replaced };
}

// ---------- the webhook: Simpan / Batal ----------

/** `toast` answers the button tap; `html` (when set) replaces the draft message */
export type DecideResult = { toast: string; html?: string };

const appLink = (appUrl: string, path: string, label: string) =>
	`<a href="${esc(`${appUrl.replace(/\/$/, '')}/${path}`)}">${label}</a>`;

const toStep = (s: StepDraft): StepInput =>
	stepSchema.parse({
		title: s.title,
		dueDate: s.due.slice(0, 10),
		dueTime: s.due.slice(11, 16),
		allDay: false,
		assigneeId: ''
	});

/** Write a draft through the app's services; returns the result line for the message */
async function applyDraft(tx: Tx, d: Draft, userId: string, appUrl: string, now: Date) {
	switch (d.kind) {
		case 'lead': {
			const { summary, clientIds } = await importRows(tx, [d.row], userId);
			const parts = [summary.clientsCreated ? 'klien baru' : 'klien lama'];
			if (summary.contactsAdded) parts.push('kontak ditambahkan');
			if (summary.contactsSkipped) parts.push('kontak sudah ada');
			if (summary.dealsCreated) parts.push('deal dibuat');
			if (summary.dealsSkipped) parts.push('deal dengan judul sama sudah ada, tidak ditambah');
			if (summary.projectsCreated) parts.push('proyek dibuat');
			return `Tersimpan: ${parts.join(', ')}. ${appLink(appUrl, `clients/${clientIds[0]}`, 'Buka klien')}`;
		}
		case 'step': {
			const ref = d.card.kind === 'deal' ? { dealId: d.card.id } : { projectId: d.card.id };
			await addAction(tx, ref, toStep(d.step), userId);
			return `Tersimpan: langkah ditambahkan. ${appLink(appUrl, 'strategy', 'Buka Strategi')}`;
		}
		case 'move': {
			const [current] = await tx
				.select({ stage: deal.stage, value: deal.valueEstimate, title: deal.title })
				.from(deal)
				.where(eq(deal.id, d.card.id));
			if (!current) throw new ServiceError('Deal tidak ditemukan.');
			if (current.stage === 'won' || current.stage === 'lost')
				throw new ServiceError('Deal ini sudah ditutup.');
			const wonProject =
				d.to === 'won'
					? wonProjectSchema.parse({
							projectName: current.title,
							contractValue: current.value ?? 0,
							startDate: dayKeyWib(now),
							firstStepTitle: 'Kick-off meeting',
							firstStepDue: wibAt(now, 3, '10:00')
						})
					: null;
			const { projectId } = await moveDeal(
				tx,
				moveSchema.parse({
					id: d.card.id,
					to: d.to,
					lostReason: d.lostReason,
					createProject: d.to === 'won' ? 'yes' : ''
				}),
				wonProject,
				userId
			);
			return `Tersimpan: deal pindah ke ${DEAL_STAGE_META[d.to].label}${projectId ? ', proyek dibuat' : ''}. ${appLink(appUrl, projectId ? 'projects' : 'pipeline', projectId ? 'Buka Proyek' : 'Buka Pipeline')}`;
		}
		case 'plan': {
			const plan = await createPlan(
				tx,
				planSchema.parse({
					card: `${d.card.kind}:${d.card.id}`,
					goal: d.goal,
					targetDate: d.targetDate
				}),
				userId
			);
			for (const s of d.steps) await addPlanStep(tx, plan.id, toStep(s), userId);
			return `Tersimpan: rencana dengan ${d.steps.length} langkah. ${appLink(appUrl, 'strategy', 'Buka Strategi')}`;
		}
		case 'note': {
			const [c] = await tx
				.select({ archivedAt: client.archivedAt })
				.from(client)
				.where(eq(client.id, d.clientId));
			if (!c) throw new ServiceError('Klien tidak ditemukan.');
			if (c.archivedAt) throw new ServiceError('Klien ini sudah diarsipkan.');
			await logActivity(tx, {
				clientId: d.clientId,
				dealId: d.card?.kind === 'deal' ? d.card.id : null,
				projectId: d.card?.kind === 'project' ? d.card.id : null,
				type: d.type,
				body: d.body,
				meta: { via: 'telegram' },
				userId
			});
			return `Tersimpan di timeline. ${appLink(appUrl, `clients/${d.clientId}`, 'Buka klien')}`;
		}
	}
}

const DECIDED: Record<string, string> = {
	saved: 'Draf ini sudah disimpan.',
	cancelled: 'Draf ini sudah dibatalkan.',
	replaced: 'Draf ini sudah diganti dengan koreksi terbaru.'
};

/** Simpan: write the draft once. A rule the CRM refuses leaves the draft open. */
export async function confirmDraft(
	db: DbOrTx,
	input: { draftId: string; chatId: string; appUrl: string },
	now = new Date()
): Promise<DecideResult> {
	try {
		return await db.transaction(async (tx) => {
			const [d] = await tx
				.select()
				.from(telegramDraft)
				.where(eq(telegramDraft.id, input.draftId))
				.for('update');
			if (!d || d.chatId !== input.chatId) return { toast: 'Draf tidak ditemukan.' };
			const draft = d.payload as unknown as Draft;
			if (d.status !== 'pending') return { toast: DECIDED[d.status] };
			if (d.expiresAt <= now)
				return {
					toast: 'Draf sudah kedaluwarsa.',
					html: `${draftPreview(draft)}\n\n<b>Kedaluwarsa.</b> Kirim ulang pesannya.`
				};
			const line = await applyDraft(tx, draft, d.userId, input.appUrl, now);
			await tx
				.update(telegramDraft)
				.set({ status: 'saved', decidedAt: now })
				.where(eq(telegramDraft.id, d.id));
			return { toast: 'Tersimpan.', html: `${draftPreview(draft)}\n\n<b>${line}</b>` };
		});
	} catch (e) {
		if (e instanceof ServiceError) return { toast: e.message.slice(0, 190) };
		throw e;
	}
}

/** Batal: nothing is written */
export async function cancelDraft(
	db: DbOrTx,
	input: { draftId: string; chatId: string },
	now = new Date()
): Promise<DecideResult> {
	const [d] = await db
		.update(telegramDraft)
		.set({ status: 'cancelled', decidedAt: now })
		.where(
			and(
				eq(telegramDraft.id, input.draftId),
				eq(telegramDraft.chatId, input.chatId),
				eq(telegramDraft.status, 'pending')
			)
		)
		.returning();
	if (!d) {
		const [other] = await db
			.select({ status: telegramDraft.status, chatId: telegramDraft.chatId })
			.from(telegramDraft)
			.where(eq(telegramDraft.id, input.draftId));
		return {
			toast:
				other && other.chatId === input.chatId ? DECIDED[other.status] : 'Draf tidak ditemukan.'
		};
	}
	return {
		toast: 'Dibatalkan.',
		html: `${draftPreview(d.payload as unknown as Draft)}\n\n<b>Dibatalkan.</b> Tidak ada yang disimpan.`
	};
}
