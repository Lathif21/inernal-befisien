// Daily digest (docs/01-PRD.md "Daily digest", task P1-12): each user's open steps that are late,
// due today (with times) and due tomorrow, in WIB, plus unpaid invoices past due or due within 3
// days (P2-09). Sent by Telegram and / or email; nothing is sent when nothing is due. Relative imports only: the Trigger.dev task runs this too.
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { dateID, dayKeyWib, rupiah, wibLocalToDate } from '../../format';
import { nextActionState } from '../../next-action';
import { addDays } from '../../period';
import type { DbOrTx } from '../db/client';
import { action, client, deal, project, user } from '../db/schema/index';
import { escapeHtml } from '../notify/telegram';
import { getAiSettings } from './ai-settings';
import { countOpenSuggestions } from './ai-suggestions';
import { invoiceAttention, type InvoiceAlert, type InvoiceAttention } from './invoice-jobs';

export type DigestItem = {
	id: string;
	title: string;
	dueAt: Date;
	allDay: boolean;
	clientName: string;
	cardTitle: string;
};

export type Digest = {
	late: DigestItem[];
	today: DigestItem[];
	tomorrow: DigestItem[];
	total: number;
};

/** Open steps assigned to the user that are late or due today / tomorrow (WIB) */
export async function getDigestItems(
	db: DbOrTx,
	userId: string,
	now = new Date()
): Promise<Digest> {
	const dayAfterTomorrow = wibLocalToDate(`${addDays(dayKeyWib(now), 2)}T00:00`)!;
	const rows = await db
		.select({
			id: action.id,
			title: action.title,
			dueAt: action.dueAt,
			allDay: action.allDay,
			clientName: client.name,
			cardTitle: sql<string>`coalesce(${project.name}, ${deal.title})`
		})
		.from(action)
		.leftJoin(deal, eq(deal.id, action.dealId))
		.leftJoin(project, eq(project.id, action.projectId))
		.innerJoin(client, eq(client.id, sql`coalesce(${deal.clientId}, ${project.clientId})`))
		.where(
			and(
				isNull(action.doneAt),
				eq(action.assigneeId, userId),
				lt(action.dueAt, dayAfterTomorrow),
				isNull(client.archivedAt)
			)
		)
		.orderBy(asc(action.dueAt), asc(action.sort));

	const digest: Digest = { late: [], today: [], tomorrow: [], total: rows.length };
	for (const r of rows) {
		const state = nextActionState(r.dueAt, now, r.allDay);
		(state === 'late' ? digest.late : state === 'today' ? digest.today : digest.tomorrow).push(r);
	}
	return digest;
}

// ---------- message text ----------

type Ctx = {
	name: string;
	now: Date;
	appUrl: string;
	/** Open AI suggestions waiting on Strategi (P2-03) */
	aiNew?: number;
	/** Unpaid invoices past due / due within 3 days (P2-09); the same for every user */
	invoices?: InvoiceAttention;
};

const aiLine = (n: number | undefined) => (n ? `${n} saran AI baru menunggu di Strategi.` : null);

/** "14:00", "Sepanjang hari", or for late steps "22 Okt 14:00" */
function when(item: DigestItem, late: boolean) {
	if (late) return item.allDay ? dateID(item.dueAt) : dateID(item.dueAt, 'datetime');
	return item.allDay ? 'Sepanjang hari' : dateID(item.dueAt, 'time');
}

const SECTIONS = [
	{ key: 'late', label: 'Terlambat', color: '#a12822' /* danger */ },
	{ key: 'today', label: 'Hari ini', color: '#9a5b00' /* warning */ },
	{ key: 'tomorrow', label: 'Besok', color: '#3e4c75' /* ink-2 */ }
] as const;

const INVOICE_SECTIONS = [
	{
		key: 'overdue',
		label: 'Invoice lewat jatuh tempo',
		count: 'invoice lewat tempo',
		color: '#a12822'
	},
	{
		key: 'dueSoon',
		label: 'Invoice segera jatuh tempo',
		count: 'invoice segera jatuh tempo',
		color: '#9a5b00'
	}
] as const;

const invoiceCount = (inv: InvoiceAttention | undefined) =>
	inv ? inv.overdue.length + inv.dueSoon.length : 0;

/** Subject line and Telegram headline: "2 terlambat · 3 hari ini · 1 besok · 1 invoice lewat tempo" */
export function digestCounts(d: Digest, inv?: InvoiceAttention) {
	return [
		...SECTIONS.filter((s) => d[s.key].length).map(
			(s) => `${d[s.key].length} ${s.label.toLowerCase()}`
		),
		...INVOICE_SECTIONS.filter((s) => inv?.[s.key].length).map(
			(s) => `${inv![s.key].length} ${s.count}`
		)
	].join(' · ');
}

/** "INV/BEF/2026/10/001 · IMR · sisa Rp 6.000.000 · jatuh tempo 21 Okt 2026" */
const invoiceLine = (i: InvoiceAlert) =>
	`${i.number} · ${i.clientName} · sisa ${rupiah(i.remaining)} · jatuh tempo ${dateID(i.dueDate)}`;

const strategyUrl = (appUrl: string) => `${appUrl.replace(/\/$/, '')}/strategy`;
const invoicesUrl = (appUrl: string) => `${appUrl.replace(/\/$/, '')}/invoices`;

/** Telegram HTML (parse_mode HTML): only <b>, <i>, <a> */
export function digestTelegram(d: Digest, ctx: Ctx) {
	const lines = [
		`<b>Ringkasan Befisien · ${escapeHtml(dateID(ctx.now, 'long'))}</b>`,
		`Halo ${escapeHtml(ctx.name.split(' ')[0])}, ${escapeHtml(digestCounts(d, ctx.invoices))}.`
	];
	for (const s of SECTIONS) {
		const items = d[s.key];
		if (!items.length) continue;
		lines.push('', `<b>${s.label} (${items.length})</b>`);
		for (const i of items)
			lines.push(
				`• ${escapeHtml(when(i, s.key === 'late'))}  ${escapeHtml(i.title)}\n   <i>${escapeHtml(i.clientName)} · ${escapeHtml(i.cardTitle)}</i>`
			);
	}
	for (const s of INVOICE_SECTIONS) {
		const items = ctx.invoices?.[s.key] ?? [];
		if (!items.length) continue;
		lines.push('', `<b>${s.label} (${items.length})</b>`);
		for (const i of items) lines.push(`• ${escapeHtml(invoiceLine(i))}`);
	}
	const ai = aiLine(ctx.aiNew);
	if (ai) lines.push('', `<i>${escapeHtml(ai)}</i>`);
	lines.push('', `<a href="${escapeHtml(strategyUrl(ctx.appUrl))}">Buka Strategi</a>`);
	if (invoiceCount(ctx.invoices))
		lines.push(`<a href="${escapeHtml(invoicesUrl(ctx.appUrl))}">Buka Invoice</a>`);
	return lines.join('\n');
}

/** Email in Befisien style: navy header, white card, sections, blue "Buka Strategi" button */
export function digestEmail(d: Digest, ctx: Ctx) {
	const esc = escapeHtml;
	const url = strategyUrl(ctx.appUrl);
	const date = dateID(ctx.now, 'long');
	const subject = `Ringkasan ${dateID(ctx.now)}: ${digestCounts(d, ctx.invoices)}`;

	const section = (s: (typeof SECTIONS)[number]) => {
		const items = d[s.key];
		if (!items.length) return '';
		const rows = items
			.map(
				(i) => `<tr>
<td style="padding:10px 0;border-top:1px solid #dce4f5;width:96px;vertical-align:top;font:600 13px/1.4 Arial,sans-serif;color:${s.color};white-space:nowrap">${esc(when(i, s.key === 'late'))}</td>
<td style="padding:10px 0;border-top:1px solid #dce4f5;vertical-align:top;font:14px/1.4 Arial,sans-serif;color:#0b1840"><b>${esc(i.title)}</b><br><span style="font-size:12.5px;color:#5e6a8e">${esc(i.clientName)} · ${esc(i.cardTitle)}</span></td>
</tr>`
			)
			.join('');
		return `<h2 style="margin:24px 0 4px;font:700 15px/1.3 Arial,sans-serif;color:${s.color}">${s.label} (${items.length})</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
	};
	const invoiceSection = (s: (typeof INVOICE_SECTIONS)[number]) => {
		const items = ctx.invoices?.[s.key] ?? [];
		if (!items.length) return '';
		const rows = items
			.map(
				(i) => `<tr>
<td style="padding:10px 0;border-top:1px solid #dce4f5;width:96px;vertical-align:top;font:600 13px/1.4 Arial,sans-serif;color:${s.color};white-space:nowrap">${esc(dateID(i.dueDate))}</td>
<td style="padding:10px 0;border-top:1px solid #dce4f5;vertical-align:top;font:14px/1.4 Arial,sans-serif;color:#0b1840"><b>${esc(i.number)}</b><br><span style="font-size:12.5px;color:#5e6a8e">${esc(i.clientName)} · sisa ${esc(rupiah(i.remaining))}</span></td>
</tr>`
			)
			.join('');
		return `<h2 style="margin:24px 0 4px;font:700 15px/1.3 Arial,sans-serif;color:${s.color}">${s.label} (${items.length})</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
	};

	const html = `<!doctype html><html lang="id"><body style="margin:0;background:#eef3ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ff;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#0b1840;border-radius:18px 18px 0 0;padding:18px 24px;font:800 18px/1 Arial,sans-serif;color:#ffffff;letter-spacing:.02em">BEFISIEN <span style="font-weight:700;font-size:11px;color:#b8c6ec;letter-spacing:.08em">CRM &amp; KEUANGAN</span></td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 18px 18px;padding:24px">
<p style="margin:0;font:800 22px/1.2 Arial,sans-serif;color:#0b1840">Halo ${esc(ctx.name.split(' ')[0])}</p>
<p style="margin:6px 0 0;font:14px/1.5 Arial,sans-serif;color:#3e4c75">${esc(date)} · ${esc(digestCounts(d, ctx.invoices))}</p>
${SECTIONS.map(section).join('')}
${INVOICE_SECTIONS.map(invoiceSection).join('')}
${aiLine(ctx.aiNew) ? `<p style="margin:24px 0 0;padding:10px 12px;border-radius:12px;background:#f7f2ff;font:600 13px/1.4 Arial,sans-serif;color:#5b2db8">${esc(aiLine(ctx.aiNew)!)}</p>` : ''}
<p style="margin:28px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:#1f5bea;color:#ffffff;border-radius:12px;padding:12px 20px;font:700 14px/1 Arial,sans-serif;text-decoration:none">Buka Strategi</a>${invoiceCount(ctx.invoices) ? ` <a href="${esc(invoicesUrl(ctx.appUrl))}" style="display:inline-block;margin-left:8px;color:#1f4fd6;padding:12px 4px;font:700 14px/1 Arial,sans-serif;text-decoration:none">Buka Invoice</a>` : ''}</p>
</td></tr>
<tr><td style="padding:14px 8px;font:12px/1.5 Arial,sans-serif;color:#5e6a8e;text-align:center">Ringkasan harian dari Befisien CRM. Matikan di Pengaturan.</td></tr>
</table>
</td></tr></table></body></html>`;

	const text = [
		`Halo ${ctx.name.split(' ')[0]}`,
		`${date} · ${digestCounts(d, ctx.invoices)}`,
		...SECTIONS.flatMap((s) =>
			d[s.key].length
				? [
						'',
						`${s.label} (${d[s.key].length})`,
						...d[s.key].map(
							(i) => `- ${when(i, s.key === 'late')}  ${i.title} (${i.clientName} · ${i.cardTitle})`
						)
					]
				: []
		),
		...INVOICE_SECTIONS.flatMap((s) => {
			const items = ctx.invoices?.[s.key] ?? [];
			return items.length
				? ['', `${s.label} (${items.length})`, ...items.map((i) => `- ${invoiceLine(i)}`)]
				: [];
		}),
		...(aiLine(ctx.aiNew) ? ['', aiLine(ctx.aiNew)!] : []),
		'',
		`Buka Strategi: ${url}`,
		...(invoiceCount(ctx.invoices) ? [`Buka Invoice: ${invoicesUrl(ctx.appUrl)}`] : [])
	].join('\n');

	return { subject, html, text };
}

// ---------- sending ----------

export type DigestUser = {
	id: string;
	name: string;
	email: string;
	telegramChatId: string | null;
	digestChannels: string[];
};

export type ChannelResult = 'sent' | 'off' | 'not-linked' | 'failed';
export type DigestResult = {
	userId: string;
	email: string;
	total: number;
	telegram: ChannelResult | 'skipped';
	mail: ChannelResult | 'skipped';
	errors: string[];
};

export type DigestSenders = {
	telegram: (chatId: string, html: string) => Promise<unknown>;
	email: (mail: { to: string; subject: string; html: string; text: string }) => Promise<unknown>;
};

/**
 * Build and send one user's digest. Empty day: nothing is sent ('skipped'). A failing channel does
 * not stop the other; errors are returned so the caller can log them.
 */
export async function sendDigest(
	db: DbOrTx,
	u: DigestUser,
	opts: {
		now?: Date;
		appUrl: string;
		senders: DigestSenders;
		aiNew?: number;
		invoices?: InvoiceAttention;
	}
): Promise<DigestResult> {
	const now = opts.now ?? new Date();
	const digest = await getDigestItems(db, u.id, now);
	const result: DigestResult = {
		userId: u.id,
		email: u.email,
		total: digest.total,
		telegram: 'skipped',
		mail: 'skipped',
		errors: []
	};
	// Invoices alone are worth a message; no steps and no invoices = nothing is sent
	if (digest.total === 0 && !invoiceCount(opts.invoices)) return result;
	const ctx = {
		name: u.name,
		now,
		appUrl: opts.appUrl,
		aiNew: opts.aiNew,
		invoices: opts.invoices
	};

	if (!u.digestChannels.includes('telegram')) result.telegram = 'off';
	else if (!u.telegramChatId) result.telegram = 'not-linked';
	else {
		try {
			await opts.senders.telegram(u.telegramChatId, digestTelegram(digest, ctx));
			result.telegram = 'sent';
		} catch (e) {
			result.telegram = 'failed';
			result.errors.push(String(e));
		}
	}

	if (!u.digestChannels.includes('email')) result.mail = 'off';
	else {
		try {
			await opts.senders.email({ to: u.email, ...digestEmail(digest, ctx) });
			result.mail = 'sent';
		} catch (e) {
			result.mail = 'failed';
			result.errors.push(String(e));
		}
	}
	return result;
}

const digestUserFields = {
	id: user.id,
	name: user.name,
	email: user.email,
	telegramChatId: user.telegramChatId,
	digestChannels: user.digestChannels
};

export function getDigestUser(db: DbOrTx, userId: string) {
	return db
		.select(digestUserFields)
		.from(user)
		.where(eq(user.id, userId))
		.then((r) => r[0] ?? null);
}

/** The scheduled run: every user with the digest switched on */
export async function runDailyDigest(
	db: DbOrTx,
	opts: {
		now?: Date;
		appUrl: string;
		senders: DigestSenders;
		aiNew?: number;
		invoices?: InvoiceAttention;
	}
) {
	const users = await db.select(digestUserFields).from(user).where(eq(user.digestEnabled, true));
	const aiNew =
		opts.aiNew ?? ((await getAiSettings(db)).enabled ? await countOpenSuggestions(db) : 0);
	const invoices = opts.invoices ?? (await invoiceAttention(db, opts.now));
	const results: DigestResult[] = [];
	for (const u of users) results.push(await sendDigest(db, u, { ...opts, aiNew, invoices }));
	return results;
}
