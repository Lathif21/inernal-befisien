// Invoice jobs (P2-09): mark unpaid invoices overdue every night, remind the team 3 days before
// the due date, and the invoice lines of the daily digest. Relative imports only: Trigger.dev runs
// this. Reminders go to the team (digest channels), never to clients.
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { dateID, dayKeyWib, rupiah } from '../../format';
import { addDays } from '../../period';
import type { DbOrTx } from '../db/client';
import { client, invoice, user } from '../db/schema/index';
import { escapeHtml } from '../notify/telegram';
import { logActivity } from './activity';
import type { DigestSenders, DigestUser } from './digest';

/** Days ahead the reminder and the digest's "segera jatuh tempo" look */
export const DUE_SOON_DAYS = 3;
/** Statuses that still wait for money */
const UNPAID = ['sent', 'partial', 'overdue'] as const;

export type InvoiceAlert = {
	id: string;
	number: string;
	clientName: string;
	dueDate: string;
	/** Cash still expected: total − PPh 23 − paid */
	remaining: number;
};

export type InvoiceAttention = { overdue: InvoiceAlert[]; dueSoon: InvoiceAlert[] };

// Correlated subquery: columns qualified (CLAUDE.md "Database notes")
const paid =
	sql<number>`(select coalesce(sum("transaction"."amount"), 0) from "transaction" where "transaction"."invoice_id" = "invoice"."id" and "transaction"."status" = 'paid')::bigint`.mapWith(
		Number
	);

async function unpaidBetween(db: DbOrTx, from: string | null, to: string) {
	const rows = await db
		.select({
			id: invoice.id,
			number: invoice.number,
			clientName: client.name,
			dueDate: invoice.dueDate,
			total: invoice.total,
			pph23Amount: invoice.pph23Amount,
			paid
		})
		.from(invoice)
		.innerJoin(client, eq(client.id, invoice.clientId))
		.where(
			and(
				inArray(invoice.status, UNPAID),
				from ? gte(invoice.dueDate, from) : undefined,
				lte(invoice.dueDate, to)
			)
		)
		.orderBy(asc(invoice.dueDate), asc(invoice.number));
	return rows.map((r): InvoiceAlert => ({
		id: r.id,
		number: r.number,
		clientName: r.clientName,
		dueDate: r.dueDate,
		remaining: Math.max(0, r.total - r.pph23Amount - r.paid)
	}));
}

/** For the digest: unpaid invoices past their due date, and those due within 3 days (WIB) */
export async function invoiceAttention(db: DbOrTx, now = new Date()): Promise<InvoiceAttention> {
	const today = dayKeyWib(now);
	const [overdue, dueSoon] = await Promise.all([
		unpaidBetween(db, null, addDays(today, -1)),
		unpaidBetween(db, today, addDays(today, DUE_SOON_DAYS))
	]);
	return { overdue, dueSoon };
}

/**
 * 00:15 WIB: "Terkirim" invoices whose due date has passed become "Jatuh tempo" (logged on the
 * client's timeline). Partly paid ones keep "Dibayar sebagian", like the payment rules (P2-07).
 */
export async function markOverdueInvoices(db: DbOrTx, now = new Date()) {
	const today = dayKeyWib(now);
	return db.transaction(async (tx) => {
		const rows = await tx
			.update(invoice)
			.set({ status: 'overdue', updatedAt: new Date() })
			.where(and(eq(invoice.status, 'sent'), lt(invoice.dueDate, today)))
			.returning({
				id: invoice.id,
				number: invoice.number,
				clientId: invoice.clientId,
				projectId: invoice.projectId,
				dueDate: invoice.dueDate
			});
		for (const r of rows)
			await logActivity(tx, {
				clientId: r.clientId,
				projectId: r.projectId,
				type: 'system',
				body: `Invoice ${r.number} lewat jatuh tempo (${dateID(r.dueDate)}) dan belum dibayar`,
				meta: { invoiceId: r.id }
			});
		return rows;
	});
}

// ---------- 08:00 reminder ----------

const invoicesUrl = (appUrl: string) => `${appUrl.replace(/\/$/, '')}/invoices`;

/** One line per invoice: "INV/BEF/2026/10/001 · IMR · sisa Rp 6.000.000" */
const line = (i: InvoiceAlert) => `${i.number} · ${i.clientName} · sisa ${rupiah(i.remaining)}`;

export function reminderTelegram(items: InvoiceAlert[], dueDate: string, appUrl: string) {
	return [
		`<b>Invoice jatuh tempo ${escapeHtml(dateID(dueDate, 'full'))}</b>`,
		`${items.length} invoice jatuh tempo ${DUE_SOON_DAYS} hari lagi. Konfirmasi pembayarannya ke klien.`,
		'',
		...items.map((i) => `• ${escapeHtml(line(i))}`),
		'',
		`<a href="${escapeHtml(invoicesUrl(appUrl))}">Buka Invoice</a>`
	].join('\n');
}

export function reminderEmail(items: InvoiceAlert[], dueDate: string, appUrl: string) {
	const esc = escapeHtml;
	const url = invoicesUrl(appUrl);
	const subject = `${items.length} invoice jatuh tempo ${dateID(dueDate)}`;
	const rows = items
		.map(
			(i) => `<tr>
<td style="padding:10px 0;border-top:1px solid #dce4f5;font:600 13px/1.4 Arial,sans-serif;color:#1f4fd6;white-space:nowrap;vertical-align:top">${esc(i.number)}</td>
<td style="padding:10px 0 10px 12px;border-top:1px solid #dce4f5;font:14px/1.4 Arial,sans-serif;color:#0b1840;vertical-align:top">${esc(i.clientName)}<br><span style="font-size:12.5px;color:#5e6a8e">sisa ${esc(rupiah(i.remaining))}</span></td>
</tr>`
		)
		.join('');
	const html = `<!doctype html><html lang="id"><body style="margin:0;background:#eef3ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ff;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#0b1840;border-radius:18px 18px 0 0;padding:18px 24px;font:800 18px/1 Arial,sans-serif;color:#ffffff;letter-spacing:.02em">BEFISIEN <span style="font-weight:700;font-size:11px;color:#b8c6ec;letter-spacing:.08em">CRM &amp; KEUANGAN</span></td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 18px 18px;padding:24px">
<p style="margin:0;font:800 20px/1.25 Arial,sans-serif;color:#0b1840">Invoice jatuh tempo ${esc(dateID(dueDate, 'full'))}</p>
<p style="margin:6px 0 16px;font:14px/1.5 Arial,sans-serif;color:#3e4c75">${items.length} invoice jatuh tempo ${DUE_SOON_DAYS} hari lagi. Konfirmasi pembayarannya ke klien.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:24px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:#1f5bea;color:#ffffff;border-radius:12px;padding:12px 20px;font:700 14px/1 Arial,sans-serif;text-decoration:none">Buka Invoice</a></p>
</td></tr>
<tr><td style="padding:14px 8px;font:12px/1.5 Arial,sans-serif;color:#5e6a8e;text-align:center">Pengingat invoice dari Befisien CRM, untuk tim. Klien tidak menerima email ini.</td></tr>
</table>
</td></tr></table></body></html>`;
	const text = [
		`Invoice jatuh tempo ${dateID(dueDate, 'full')}`,
		`${items.length} invoice jatuh tempo ${DUE_SOON_DAYS} hari lagi. Konfirmasi pembayarannya ke klien.`,
		'',
		...items.map((i) => `- ${line(i)}`),
		'',
		`Buka Invoice: ${url}`
	].join('\n');
	return { subject, html, text };
}

export type ReminderResult = {
	email: string;
	telegram: 'sent' | 'off' | 'not-linked' | 'failed';
	mail: 'sent' | 'off' | 'failed';
	errors: string[];
};

/**
 * 08:00 WIB: unpaid invoices due exactly 3 days from today, sent to every user with the digest on
 * through their digest channels. Nothing is sent when no invoice is due that day.
 */
export async function runInvoiceReminder(
	db: DbOrTx,
	opts: { now?: Date; appUrl: string; senders: DigestSenders }
) {
	const dueDate = addDays(dayKeyWib(opts.now ?? new Date()), DUE_SOON_DAYS);
	const items = await unpaidBetween(db, dueDate, dueDate);
	if (!items.length) return { dueDate, invoices: 0, results: [] as ReminderResult[] };

	const users: DigestUser[] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			telegramChatId: user.telegramChatId,
			digestChannels: user.digestChannels
		})
		.from(user)
		.where(eq(user.digestEnabled, true));
	const results: ReminderResult[] = [];
	for (const u of users) {
		const r: ReminderResult = { email: u.email, telegram: 'off', mail: 'off', errors: [] };
		if (u.digestChannels.includes('telegram')) {
			if (!u.telegramChatId) r.telegram = 'not-linked';
			else
				try {
					await opts.senders.telegram(
						u.telegramChatId,
						reminderTelegram(items, dueDate, opts.appUrl)
					);
					r.telegram = 'sent';
				} catch (e) {
					r.telegram = 'failed';
					r.errors.push(String(e));
				}
		}
		if (u.digestChannels.includes('email'))
			try {
				await opts.senders.email({ to: u.email, ...reminderEmail(items, dueDate, opts.appUrl) });
				r.mail = 'sent';
			} catch (e) {
				r.mail = 'failed';
				r.errors.push(String(e));
			}
		results.push(r);
	}
	return { dueDate, invoices: items.length, results };
}
