// Email (P3-08, page /inbox): store mail from Resend Inbound, thread it, match it to a client, send
// replies. Relative imports only: services are shared with Trigger.dev tasks.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
	composeEmail,
	formatAddress,
	headerValue,
	htmlToText,
	isBulk,
	parseAddress,
	parseMessageIds,
	replyReferences,
	replySubject,
	snippetOf,
	type Address,
	type Signature
} from '../../email';
import { phoneDisplay } from '../../format';
import { contactSchema } from '../../schemas/contact';
import type { DbOrTx } from '../db/client';
import { client, contact, emailMessage, user, type EmailAttachment } from '../db/schema/index';
import type { OutgoingMail } from '../notify/email';
import type { ReceivedEmail } from '../notify/resend-inbound';
import { escapeHtml } from '../notify/telegram';
import { logActivity } from './activity';
import { getCompanyProfile } from './company';
import { saveContact } from './contacts';
import { ServiceError } from './errors';

export const INBOX_PAGE_SIZE = 25;

/** A received email, mapped from Resend and ready to store */
export type IncomingEmail = {
	resendId: string;
	messageId: string | null;
	inReplyTo: string | null;
	references: string[];
	from: Address;
	to: string[];
	cc: string[];
	replyTo: string | null;
	subject: string;
	text: string;
	html: string | null;
	attachments: EmailAttachment[];
	bulk: boolean;
	sentAt: Date;
};

/** Resend's received email → what the inbox stores */
export function fromReceived(email: ReceivedEmail): IncomingEmail {
	const headers = email.headers ?? {};
	const from = parseAddress(headerValue(headers, 'from') ?? email.from) ??
		parseAddress(email.from) ?? { name: null, email: email.from.trim().toLowerCase() };
	const date = new Date(headerValue(headers, 'date') ?? '');
	const html = email.html?.trim() || null;
	return {
		resendId: email.id,
		messageId: parseMessageIds(email.message_id ?? headerValue(headers, 'message-id'))[0] ?? null,
		inReplyTo: parseMessageIds(headerValue(headers, 'in-reply-to'))[0] ?? null,
		references: parseMessageIds(headerValue(headers, 'references')),
		from,
		to: email.to ?? [],
		cc: email.cc ?? [],
		replyTo: email.reply_to?.[0] ?? null,
		subject: (email.subject ?? '').trim(),
		text: email.text?.trim() || (html ? htmlToText(html) : ''),
		html,
		attachments: (email.attachments ?? [])
			.map((a) => ({
				id: a.id,
				filename: a.filename || 'lampiran',
				contentType: a.content_type,
				size: a.size,
				inline: a.content_disposition === 'inline' && !!a.content_id
			}))
			.filter((a) => !a.inline),
		bulk: isBulk(headers),
		sentAt: Number.isNaN(date.getTime()) ? new Date(email.created_at) : date
	};
}

/** "Re: Fwd: Penawaran" and "penawaran" are the same conversation */
const baseSubject = (s: string) =>
	s
		.replace(/^(\s*(re|fwd?|aw|sv|balas|tr)\s*:\s*)+/i, '')
		.trim()
		.toLowerCase();

/** The thread a message belongs to: by Message-ID, else a reply to something we sent */
async function findThread(db: DbOrTx, ids: string[], fallback?: { subject: string; from: string }) {
	if (ids.length) {
		const [hit] = await db
			.select({ threadId: emailMessage.threadId })
			.from(emailMessage)
			.where(inArray(emailMessage.messageId, ids))
			.orderBy(desc(emailMessage.sentAt))
			.limit(1);
		if (hit) return hit.threadId;
	}
	// Resend sets its own Message-ID on what we send, so a reply to a new email from the CRM may
	// point at an id we never saw: match "Re: <subject>" from someone we wrote to (last 90 days)
	if (fallback && /^\s*(re|balas|aw|sv)\s*:/i.test(fallback.subject)) {
		const [hit] = await db
			.select({ threadId: emailMessage.threadId })
			.from(emailMessage)
			.where(
				and(
					eq(emailMessage.direction, 'out'),
					sql`lower(regexp_replace(${emailMessage.subject}, '^(\\s*(re|fwd?|aw|sv|balas|tr)\\s*:\\s*)+', '', 'i')) = ${baseSubject(fallback.subject)}`,
					sql`array_to_string(${emailMessage.to} || ${emailMessage.cc}, ' ') ilike ${`%${fallback.from}%`}`,
					sql`${emailMessage.sentAt} > now() - interval '90 days'`
				)
			)
			.orderBy(desc(emailMessage.sentAt))
			.limit(1);
		if (hit) return hit.threadId;
	}
	return null;
}

/** The contact with this address; a primary contact and an active client win */
async function contactByEmail(db: DbOrTx, emails: string[]) {
	if (!emails.length) return null;
	const [hit] = await db
		.select({ contactId: contact.id, clientId: contact.clientId, clientName: client.name })
		.from(contact)
		.innerJoin(client, eq(client.id, contact.clientId))
		.where(
			inArray(
				sql`lower(${contact.email})`,
				emails.map((e) => e.toLowerCase())
			)
		)
		.orderBy(sql`${client.archivedAt} is not null`, desc(contact.isPrimary), asc(contact.createdAt))
		.limit(1);
	return hit ?? null;
}

async function threadClient(db: DbOrTx, threadId: string) {
	const [hit] = await db
		.select({ clientId: emailMessage.clientId })
		.from(emailMessage)
		.where(and(eq(emailMessage.threadId, threadId), sql`${emailMessage.clientId} is not null`))
		.orderBy(desc(emailMessage.sentAt))
		.limit(1);
	return hit?.clientId ?? null;
}

const timelineBody = (direction: 'in' | 'out', subject: string, snippet: string) =>
	`${direction === 'in' ? 'Email masuk' : 'Email terkirim'}: ${subject || '(tanpa subjek)'}${snippet ? `\n${snippet}` : ''}`;

/**
 * Store one received email (idempotent: the same Resend id or Message-ID is stored once). Returns
 * `created: false` for a repeat, so the webhook sends no second alert.
 */
export async function receiveEmail(db: DbOrTx, input: IncomingEmail) {
	return db.transaction(async (tx) => {
		const [dupe] = await tx
			.select({ id: emailMessage.id })
			.from(emailMessage)
			.where(
				or(
					eq(emailMessage.resendId, input.resendId),
					input.messageId
						? and(eq(emailMessage.messageId, input.messageId), eq(emailMessage.direction, 'in'))
						: undefined
				)
			)
			.limit(1);
		if (dupe) return { created: false as const, id: dupe.id };

		const id = randomUUID();
		const parentIds = [...(input.inReplyTo ? [input.inReplyTo] : []), ...input.references];
		const threadId =
			(await findThread(tx, parentIds, { subject: input.subject, from: input.from.email })) ?? id;
		const match = await contactByEmail(tx, [input.from.email]);
		const clientId = match?.clientId ?? (threadId !== id ? await threadClient(tx, threadId) : null);
		const snippet = snippetOf(input.text);

		const [row] = await tx
			.insert(emailMessage)
			.values({
				id,
				direction: 'in',
				resendId: input.resendId,
				messageId: input.messageId,
				inReplyTo: input.inReplyTo,
				references: input.references,
				threadId,
				fromEmail: input.from.email,
				fromName: input.from.name,
				to: input.to,
				cc: input.cc,
				replyTo: input.replyTo,
				subject: input.subject,
				text: input.text,
				html: input.html,
				snippet,
				attachments: input.attachments,
				bulk: input.bulk,
				clientId,
				contactId: match?.contactId ?? null,
				sentAt: input.sentAt
			})
			.onConflictDoNothing({ target: emailMessage.resendId })
			.returning();
		// A parallel delivery of the same webhook won the insert
		if (!row) return { created: false as const, id: null };

		if (clientId)
			await logActivity(tx, {
				clientId,
				type: 'email',
				body: timelineBody('in', input.subject, snippet),
				meta: { emailId: id, threadId, direction: 'in' },
				occurredAt: input.sentAt
			});

		const [c] = clientId
			? await tx.select({ name: client.name }).from(client).where(eq(client.id, clientId))
			: [];
		return { created: true as const, id, message: row, clientName: c?.name ?? null };
	});
}

export type SendInput = {
	/** Reply in this thread; empty = a new email */
	threadId?: string;
	to: Address[];
	cc: Address[];
	subject: string;
	body: string;
	/** From the form, so a double submit sends once (Resend Idempotency-Key) */
	key: string;
};

export type SendDeps = {
	/** "Befisien Technologies <info@befisien.com>" */
	from: Address;
	send: (mail: OutgoingMail) => Promise<string>;
};

/** The message a reply answers: the thread's last one */
async function lastMessage(db: DbOrTx, threadId: string) {
	const [m] = await db
		.select()
		.from(emailMessage)
		.where(eq(emailMessage.threadId, threadId))
		.orderBy(desc(emailMessage.sentAt), desc(emailMessage.createdAt))
		.limit(1);
	return m ?? null;
}

/**
 * The signature under every email from the CRM: the writer, then the company from Pengaturan →
 * Profil perusahaan. Example values (profile not saved yet) are left out, never sent to a client.
 */
export async function emailSignature(
	db: DbOrTx,
	userId: string,
	from: Address
): Promise<Signature> {
	const [[u], company] = await Promise.all([
		db.select({ name: user.name }).from(user).where(eq(user.id, userId)),
		getCompanyProfile(db)
	]);
	const companyName = company.isExample ? (from.name ?? 'Befisien') : company.name;
	const name = u?.name?.trim() || null;
	return {
		name: name && name.toLowerCase() !== companyName.toLowerCase() ? name : null,
		company: companyName,
		phone: !company.isExample && company.phone ? phoneDisplay(company.phone) : null,
		email: from.email,
		website: from.email.split('@')[1] ?? null,
		city: !company.isExample && company.city ? company.city : null
	};
}

/** Send an email or a threaded reply through Resend, then store it and log it on the timeline */
export async function sendEmailMessage(
	db: DbOrTx,
	input: SendInput,
	userId: string,
	deps: SendDeps
) {
	if (!input.to.length) throw new ServiceError('Isi minimal satu penerima.', 'to');
	if (!input.body.trim()) throw new ServiceError('Tulis isi email.', 'body');
	const parent = input.threadId ? await lastMessage(db, input.threadId) : null;
	if (input.threadId && !parent) throw new ServiceError('Percakapan email tidak ditemukan.');

	const subject = parent
		? input.subject.trim() || replySubject(parent.subject)
		: input.subject.trim();
	if (!subject) throw new ServiceError('Isi subjek email.', 'subject');
	const { text, html } = composeEmail({
		body: input.body,
		signature: await emailSignature(db, userId, deps.from),
		parent: parent
			? {
					from: formatAddress({ name: parent.fromName, email: parent.fromEmail }),
					sentAt: parent.sentAt,
					text: parent.text ?? (parent.html ? htmlToText(parent.html) : '')
				}
			: undefined
	});
	const domain = deps.from.email.split('@')[1];
	const messageId = `<${randomUUID()}@${domain}>`;
	const references = parent ? replyReferences(parent) : [];
	const headers: Record<string, string> = { 'Message-ID': messageId };
	if (parent?.messageId) headers['In-Reply-To'] = parent.messageId;
	if (references.length) headers['References'] = references.join(' ');

	const to = input.to.map(formatAddress);
	const cc = input.cc.map(formatAddress);
	const resendId = await deps.send({
		to,
		cc,
		subject,
		text,
		html,
		headers,
		idempotencyKey: `email-${input.key}`
	});

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ id: emailMessage.id, threadId: emailMessage.threadId })
			.from(emailMessage)
			.where(eq(emailMessage.resendId, resendId));
		// Same key twice: Resend sent it once and returned the same id
		if (existing) return existing;

		const id = randomUUID();
		const threadId = parent?.threadId ?? id;
		const clientId =
			(parent ? await threadClient(tx, threadId) : null) ??
			(
				await contactByEmail(
					tx,
					[...input.to, ...input.cc].map((a) => a.email)
				)
			)?.clientId ??
			null;
		const snippet = snippetOf(input.body);
		const now = new Date();
		await tx.insert(emailMessage).values({
			id,
			direction: 'out',
			resendId,
			messageId,
			inReplyTo: parent?.messageId ?? null,
			references,
			threadId,
			fromEmail: deps.from.email,
			fromName: deps.from.name,
			to,
			cc,
			subject,
			text,
			html,
			snippet,
			clientId,
			userId,
			readAt: now,
			sentAt: now
		});
		if (parent) await markThread(tx, threadId, true);
		if (clientId)
			await logActivity(tx, {
				clientId,
				type: 'email',
				body: timelineBody('out', subject, snippet),
				meta: { emailId: id, threadId, direction: 'out' },
				userId
			});
		return { id, threadId };
	});
}

export const INBOX_FILTERS = ['all', 'unread', 'client', 'none', 'sent'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** Threads, newest activity first, with counts for the filter chips */
export async function listThreads(
	db: DbOrTx,
	{
		filter = 'all',
		q,
		page = 1,
		pageSize = INBOX_PAGE_SIZE
	}: { filter?: InboxFilter; q?: string; page?: number; pageSize?: number } = {}
) {
	const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
	const t = db
		.select({
			threadId: emailMessage.threadId,
			lastAt: sql<Date>`max(${emailMessage.sentAt})`.as('last_at'),
			count: sql<number>`count(*)::int`.as('message_count'),
			unread:
				sql<number>`(count(*) filter (where ${emailMessage.direction} = 'in' and ${emailMessage.readAt} is null))::int`.as(
					'unread'
				),
			hasOut: sql<boolean>`bool_or(${emailMessage.direction} = 'out')`.as('has_out'),
			clientId: sql<
				string | null
			>`(array_agg(${emailMessage.clientId} order by ${emailMessage.sentAt} desc) filter (where ${emailMessage.clientId} is not null))[1]`.as(
				'thread_client_id'
			)
		})
		.from(emailMessage)
		.where(
			like
				? or(
						ilike(emailMessage.subject, like),
						ilike(emailMessage.fromEmail, like),
						ilike(emailMessage.fromName, like),
						ilike(emailMessage.snippet, like)
					)
				: undefined
		)
		.groupBy(emailMessage.threadId)
		.as('t');

	const where = {
		all: undefined,
		unread: sql`${t.unread} > 0`,
		client: sql`${t.clientId} is not null`,
		none: sql`${t.clientId} is null`,
		sent: sql`${t.hasOut}`
	}[filter];

	const [threads, [counts]] = await Promise.all([
		db
			.select({
				threadId: t.threadId,
				lastAt: t.lastAt,
				count: t.count,
				unread: t.unread,
				clientId: t.clientId
			})
			.from(t)
			.where(where)
			.orderBy(desc(t.lastAt))
			.limit(pageSize)
			.offset((Math.max(1, page) - 1) * pageSize),
		db
			.select({
				all: sql<number>`count(*)::int`,
				unread: sql<number>`(count(*) filter (where ${t.unread} > 0))::int`,
				client: sql<number>`(count(*) filter (where ${t.clientId} is not null))::int`,
				none: sql<number>`(count(*) filter (where ${t.clientId} is null))::int`,
				sent: sql<number>`(count(*) filter (where ${t.hasOut}))::int`
			})
			.from(t)
	]);

	const ids = threads.map((r) => r.threadId);
	const latest = ids.length
		? await db
				.selectDistinctOn([emailMessage.threadId], {
					threadId: emailMessage.threadId,
					direction: emailMessage.direction,
					fromEmail: emailMessage.fromEmail,
					fromName: emailMessage.fromName,
					to: emailMessage.to,
					subject: emailMessage.subject,
					snippet: emailMessage.snippet,
					hasAttachments: sql<boolean>`jsonb_array_length(${emailMessage.attachments}) > 0`
				})
				.from(emailMessage)
				.where(inArray(emailMessage.threadId, ids))
				.orderBy(emailMessage.threadId, desc(emailMessage.sentAt), desc(emailMessage.createdAt))
		: [];
	const clientIds = [...new Set(threads.map((r) => r.clientId).filter((c): c is string => !!c))];
	const clients = clientIds.length
		? await db
				.select({ id: client.id, name: client.name })
				.from(client)
				.where(inArray(client.id, clientIds))
		: [];
	const byThread = new Map(latest.map((m) => [m.threadId, m]));
	const clientName = new Map(clients.map((c) => [c.id, c.name]));

	return {
		rows: threads.map((r) => ({
			...r,
			lastAt: new Date(r.lastAt),
			clientName: r.clientId ? (clientName.get(r.clientId) ?? null) : null,
			last: byThread.get(r.threadId)!
		})),
		counts,
		total: counts[filter],
		page: Math.max(1, page),
		pageSize
	};
}

export type ThreadRow = Awaited<ReturnType<typeof listThreads>>['rows'][number];

/** Every message of a thread, oldest first, with the client and who sent the outgoing ones */
export async function getThread(db: DbOrTx, threadId: string) {
	const messages = await db
		.select({
			id: emailMessage.id,
			direction: emailMessage.direction,
			messageId: emailMessage.messageId,
			fromEmail: emailMessage.fromEmail,
			fromName: emailMessage.fromName,
			to: emailMessage.to,
			cc: emailMessage.cc,
			replyTo: emailMessage.replyTo,
			subject: emailMessage.subject,
			text: emailMessage.text,
			html: emailMessage.html,
			attachments: emailMessage.attachments,
			bulk: emailMessage.bulk,
			readAt: emailMessage.readAt,
			sentAt: emailMessage.sentAt,
			clientId: emailMessage.clientId,
			userName: user.name
		})
		.from(emailMessage)
		.leftJoin(user, eq(user.id, emailMessage.userId))
		.where(eq(emailMessage.threadId, threadId))
		.orderBy(asc(emailMessage.sentAt), asc(emailMessage.createdAt));
	if (!messages.length) return null;
	const clientId = messages.findLast((m) => m.clientId)?.clientId ?? null;
	const [c] = clientId
		? await db
				.select({ id: client.id, name: client.name })
				.from(client)
				.where(eq(client.id, clientId))
		: [];
	return { threadId, messages, client: c ?? null };
}

export type ThreadMessage = NonNullable<Awaited<ReturnType<typeof getThread>>>['messages'][number];

/** Who a reply goes to by default: the sender (Reply-To first), Cc kept, our own address dropped */
export function replyDefaults(messages: ThreadMessage[], inbox: string) {
	const last = messages.at(-1);
	if (!last) return { to: '', cc: '', subject: '' };
	const self = inbox.toLowerCase();
	const notSelf = (raw: string) => parseAddress(raw)?.email !== self;
	const to =
		last.direction === 'in'
			? [last.replyTo ?? formatAddress({ name: last.fromName, email: last.fromEmail })]
			: last.to;
	const toEmails = new Set(to.map((a) => parseAddress(a)?.email));
	const cc = last.cc.filter((a) => notSelf(a) && !toEmails.has(parseAddress(a)?.email));
	return {
		to: to.filter(notSelf).join(', '),
		cc: cc.join(', '),
		subject: replySubject(last.subject)
	};
}

/** Opened = read; "Tandai belum dibaca" puts the thread back in Belum dibaca */
export async function markThread(db: DbOrTx, threadId: string, read: boolean) {
	if (read)
		await db
			.update(emailMessage)
			.set({ readAt: new Date() })
			.where(
				and(
					eq(emailMessage.threadId, threadId),
					eq(emailMessage.direction, 'in'),
					isNull(emailMessage.readAt)
				)
			);
	else {
		// Only the last incoming message, like a mail app
		const [last] = await db
			.select({ id: emailMessage.id })
			.from(emailMessage)
			.where(and(eq(emailMessage.threadId, threadId), eq(emailMessage.direction, 'in')))
			.orderBy(desc(emailMessage.sentAt))
			.limit(1);
		if (!last) throw new ServiceError('Tidak ada email masuk di percakapan ini.');
		await db.update(emailMessage).set({ readAt: null }).where(eq(emailMessage.id, last.id));
	}
}

/** Threads with at least one unread incoming message (sidebar badge) */
export async function unreadThreadCount(db: DbOrTx) {
	const [r] = await db
		.select({ n: sql<number>`count(distinct ${emailMessage.threadId})::int` })
		.from(emailMessage)
		.where(and(eq(emailMessage.direction, 'in'), isNull(emailMessage.readAt)));
	return r?.n ?? 0;
}

/**
 * Link a thread to a client by hand: every message gets the client, each one that had none goes
 * on the timeline, and the sender can be saved as a contact.
 */
export async function linkThread(
	db: DbOrTx,
	input: { threadId: string; clientId: string; addContact: boolean },
	userId: string
) {
	return db.transaction(async (tx) => {
		const [c] = await tx
			.select({ id: client.id, archivedAt: client.archivedAt })
			.from(client)
			.where(eq(client.id, input.clientId));
		if (!c) throw new ServiceError('Klien tidak ditemukan.', 'clientId');
		if (c.archivedAt) throw new ServiceError('Klien sudah diarsipkan.', 'clientId');
		const messages = await tx
			.select()
			.from(emailMessage)
			.where(eq(emailMessage.threadId, input.threadId))
			.orderBy(asc(emailMessage.sentAt));
		if (!messages.length) throw new ServiceError('Percakapan email tidak ditemukan.');

		await tx
			.update(emailMessage)
			.set({ clientId: input.clientId })
			.where(eq(emailMessage.threadId, input.threadId));
		for (const m of messages.filter((m) => m.clientId !== input.clientId))
			await logActivity(tx, {
				clientId: input.clientId,
				type: 'email',
				body: timelineBody(m.direction, m.subject, m.snippet),
				meta: { emailId: m.id, threadId: m.threadId, direction: m.direction },
				userId: m.direction === 'out' ? m.userId : null,
				occurredAt: m.sentAt
			});

		const sender = messages.find((m) => m.direction === 'in');
		if (input.addContact && sender && !(await contactByEmail(tx, [sender.fromEmail]))) {
			const saved = await saveContact(
				tx,
				input.clientId,
				contactSchema.parse({
					name: (sender.fromName || sender.fromEmail).slice(0, 100),
					email: sender.fromEmail
				}),
				userId
			);
			await tx
				.update(emailMessage)
				.set({ contactId: saved.id })
				.where(
					and(
						eq(emailMessage.threadId, input.threadId),
						eq(emailMessage.fromEmail, sender.fromEmail)
					)
				);
		}
	});
}

/** The Resend ids needed to fetch a fresh attachment link; null when it is not ours */
export async function attachmentSource(db: DbOrTx, emailId: string, attachmentId: string) {
	const [m] = await db
		.select({
			resendId: emailMessage.resendId,
			direction: emailMessage.direction,
			attachments: emailMessage.attachments
		})
		.from(emailMessage)
		.where(eq(emailMessage.id, emailId));
	if (!m || m.direction !== 'in' || !m.attachments.some((a) => a.id === attachmentId)) return null;
	return { resendId: m.resendId };
}

/** Telegram chats of every linked user: each new email is announced to the whole team */
export async function alertChats(db: DbOrTx) {
	const rows = await db
		.select({ chatId: user.telegramChatId })
		.from(user)
		.where(sql`${user.telegramChatId} is not null`);
	return rows.map((r) => r.chatId!);
}

/** The Telegram alert for one new email */
export function emailAlertTelegram(
	m: {
		fromName: string | null;
		fromEmail: string;
		subject: string;
		snippet: string;
		attachments: EmailAttachment[];
	},
	ctx: { clientName: string | null; url: string }
) {
	const sender = m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
	const lines = [
		`<b>Email baru</b> dari ${escapeHtml(sender)}`,
		ctx.clientName
			? `Klien: <b>${escapeHtml(ctx.clientName)}</b>`
			: '<i>Belum terhubung ke klien</i>',
		'',
		`<b>${escapeHtml(m.subject || '(tanpa subjek)')}</b>`
	];
	if (m.snippet) lines.push(escapeHtml(m.snippet));
	if (m.attachments.length) lines.push(`<i>${m.attachments.length} lampiran</i>`);
	lines.push('', `<a href="${escapeHtml(ctx.url)}">Buka email</a>`);
	return lines.join('\n');
}
