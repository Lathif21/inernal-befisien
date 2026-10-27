// Email (P3-08, page /inbox): store mail from Resend Inbound, thread it, match it to a client, send
// replies. Relative imports only: services are shared with Trigger.dev tasks.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
	attachmentExpired,
	composeEmail,
	EMAIL_MAX_FILES,
	EMAIL_UPLOAD_LIMIT,
	fileSize,
	formatAddress,
	headerValue,
	htmlToText,
	isBlockedFile,
	isBulk,
	parseAddress,
	parseMessageIds,
	replyReferences,
	replySubject,
	snippetOf,
	uploadSize,
	type Address,
	type EmailBrand,
	type Signature
} from '../../email';
import { TRASH_DAYS } from '../../email-draft';
import {
	EMAIL_ATTACH_BUDGET,
	EMAIL_FILE_LINK_DAYS,
	fileLinksHtml,
	fileLinksText,
	planFiles
} from '../../email-files';
import { forwardHtml, forwardSubject, forwardText } from '../../email-forward';
import { phoneDisplay } from '../../format';
import { contactSchema } from '../../schemas/contact';
import type { DbOrTx } from '../db/client';
import {
	client,
	contact,
	emailFile,
	emailMessage,
	user,
	type EmailAttachment
} from '../db/schema/index';
import { cleanEmailHtml, embedImages, isEmptyBody } from '../email-html';
import type { OutgoingMail } from '../notify/email';
import type { ReceivedEmail } from '../notify/resend-inbound';
import { escapeHtml } from '../notify/telegram';
import type { FileStorage } from '../storage/files';
import { logActivity } from './activity';
import { newFileToken, uploadedFiles } from './email-files';
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

const timelineBody = (direction: 'in' | 'out' | 'forward', subject: string, snippet: string) =>
	`${{ in: 'Email masuk', out: 'Email terkirim', forward: 'Email diteruskan' }[direction]}: ${subject || '(tanpa subjek)'}${snippet ? `\n${snippet}` : ''}`;

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
		// A new message brings a conversation in Sampah back, like a mail app
		if (threadId !== id) await restoreThread(tx, threadId);
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
	/** The compose editor's HTML; pictures inside it are base64 `data:` sources */
	body: string;
	/** From the form, so a double submit sends once (Resend Idempotency-Key) */
	key: string;
	files?: SendFile[];
	/**
	 * Forward this stored email under the message (a new conversation, no reply headers), with the
	 * chosen ones of its attachments fetched again from Resend. The body may then be empty.
	 */
	forward?: { emailId: string; attachmentIds: string[] };
	/**
	 * email_file ids uploaded to the bucket in the drawer: attached while they fit in
	 * EMAIL_ATTACH_BUDGET, the rest sent as download links (/f/<token>, EMAIL_FILE_LINK_DAYS)
	 */
	uploads?: string[];
};

/** Resend refuses an email above 40 MB after base64; forwarded files stay well under that */
export const FORWARD_FILES_LIMIT = 25 * 1024 * 1024;

/** Where a stored attachment is at Resend, for fetching it again (forwarding) */
export type AttachmentSource = {
	direction: 'in' | 'out';
	resendId: string;
	attachment: EmailAttachment;
	/** The how-manieth file with this name on its email (sent attachments are found by name) */
	nth: number;
};

/** A file attached in the drawer */
export type SendFile = {
	filename: string;
	contentType: string;
	data: Uint8Array;
	/** An upload from the bucket (email_file) */
	fileId?: string;
};

function needStorage(deps: SendDeps): FileStorage {
	if (!deps.storage)
		throw new ServiceError(
			'Penyimpanan file belum diatur (NEON_STORAGE_*). Kirim tanpa lampiran atau hubungi admin.',
			'files'
		);
	return deps.storage;
}

/** "Laporan Q3.pdf" as a safe attachment name (no path, quotes or line breaks) */
const fileName = (raw: string) =>
	raw
		.split(/[\\/]/)
		.pop()!
		.replace(/[\r\n"<>]+/g, '_')
		.trim()
		.slice(-200) || 'lampiran';

function checkFiles(body: string, files: SendFile[]) {
	if (files.length > EMAIL_MAX_FILES)
		throw new ServiceError(`Maksimal ${EMAIL_MAX_FILES} lampiran per email.`, 'files');
	const blocked = files.find((f) => isBlockedFile(f.filename));
	if (blocked)
		throw new ServiceError(
			`${blocked.filename} tidak bisa dikirim: file program ditolak layanan email.`,
			'files'
		);
	const size = uploadSize(
		body,
		files.map((f) => ({ size: f.data.byteLength }))
	);
	if (size > EMAIL_UPLOAD_LIMIT)
		throw new ServiceError(
			`Lampiran dan gambar ${fileSize(size)}, maksimal ${fileSize(EMAIL_UPLOAD_LIMIT)} per email.`,
			'files'
		);
}

export type SendDeps = {
	/** "Befisien <info@befisien.com>" */
	from: Address;
	/** Logo, tagline, services and profiles in the signature */
	brand: EmailBrand;
	send: (mail: OutgoingMail) => Promise<string>;
	/** The bytes of a stored attachment, fetched from Resend (forwarding only) */
	loadAttachment?: (source: AttachmentSource) => Promise<Uint8Array>;
	/** The bucket for uploads (null when NEON_STORAGE_* is not set) */
	storage?: FileStorage | null;
	/** Public base URL of the app, for download links (https://befisien-crm.vercel.app) */
	appUrl?: string;
};

/** The email to forward and the bytes of the attachments chosen to go with it */
async function loadForward(db: DbOrTx, forward: NonNullable<SendInput['forward']>, deps: SendDeps) {
	const [m] = await db.select().from(emailMessage).where(eq(emailMessage.id, forward.emailId));
	if (!m) throw new ServiceError('Email yang diteruskan tidak ditemukan.');
	const chosen = m.attachments.filter((a) => !a.inline && forward.attachmentIds.includes(a.id));
	if (chosen.length && attachmentExpired(m.sentAt))
		throw new ServiceError(
			'Lampiran email ini sudah tidak tersedia di Resend. Teruskan tanpa lampiran.',
			'forwardFiles'
		);
	const blocked = chosen.find((a) => isBlockedFile(a.filename));
	if (blocked)
		throw new ServiceError(
			`${blocked.filename} tidak bisa diteruskan: file program ditolak layanan email.`,
			'forwardFiles'
		);
	const size = chosen.reduce((s, a) => s + a.size, 0);
	if (size > FORWARD_FILES_LIMIT)
		throw new ServiceError(
			`Lampiran yang diteruskan ${fileSize(size)}, maksimal ${fileSize(FORWARD_FILES_LIMIT)}. Kurangi lampiran.`,
			'forwardFiles'
		);
	if (chosen.length && !deps.loadAttachment) throw new Error('loadAttachment is not configured');
	const files: SendFile[] = await Promise.all(
		chosen.map(async (a) => {
			const nth = m.attachments.filter((b) => b.filename === a.filename).indexOf(a);
			const data = await deps.loadAttachment!({
				direction: m.direction,
				resendId: m.resendId,
				attachment: a,
				nth
			}).catch((e) => {
				console.error('[email] forward attachment failed:', String(e));
				throw new ServiceError(
					`${a.filename} tidak bisa diambil dari Resend. Coba lagi, atau teruskan tanpa lampiran ini.`,
					'forwardFiles'
				);
			});
			return { filename: a.filename, contentType: a.contentType, data };
		})
	);
	return { message: m, files };
}

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
 * The signature under every email from the CRM: the writer, the brand name ("Befisien"), then phone
 * and city from Pengaturan → Profil perusahaan. Example values (profile not saved yet) are left
 * out, never sent to a client.
 */
export async function emailSignature(
	db: DbOrTx,
	userId: string,
	{ from, brand }: Pick<SendDeps, 'from' | 'brand'>
): Promise<Signature> {
	const [[u], company] = await Promise.all([
		db.select({ name: user.name }).from(user).where(eq(user.id, userId)),
		getCompanyProfile(db)
	]);
	// The brand name, not the legal name in the profile (which keeps "Technologies" for invoices)
	const name = u?.name?.trim() || null;
	return {
		name: name && name.toLowerCase() !== brand.name.toLowerCase() ? name : null,
		company: brand.name,
		phone: !company.isExample && company.phone ? phoneDisplay(company.phone) : null,
		email: from.email,
		website: from.email.split('@')[1] ?? null,
		city: !company.isExample && company.city ? company.city : null,
		brand
	};
}

/**
 * Send an email or a threaded reply through Resend, then store it and log it on the timeline.
 * Pictures in the body go out as inline attachments (cid:) and stay in the stored HTML as `data:`;
 * files are kept by Resend only (RESEND_RETENTION_DAYS) and listed on the message.
 */
export async function sendEmailMessage(
	db: DbOrTx,
	input: SendInput,
	userId: string,
	deps: SendDeps
) {
	if (!input.to.length) throw new ServiceError('Isi minimal satu penerima.', 'to');
	const files = (input.files ?? []).map((f) => ({ ...f, filename: fileName(f.filename) }));
	checkFiles(input.body, files);
	const body = cleanEmailHtml(input.body);
	// A forward may go without a message of its own
	const emptyBody = isEmptyBody(body);
	if (emptyBody && !input.forward) throw new ServiceError('Tulis isi email.', 'body');
	const forwarded = input.forward ? await loadForward(db, input.forward, deps) : null;
	// A forward is a new conversation: it does not answer the thread it came from
	const parent = input.threadId && !forwarded ? await lastMessage(db, input.threadId) : null;
	if (input.threadId && !forwarded && !parent)
		throw new ServiceError('Percakapan email tidak ditemukan.');

	// Uploads: attached while they fit next to the pictures and forwarded files, the rest as links
	const uploads = input.uploads?.length
		? await uploadedFiles(db, needStorage(deps), input.uploads)
		: [];
	if (files.length + uploads.length > EMAIL_MAX_FILES)
		throw new ServiceError(`Maksimal ${EMAIL_MAX_FILES} lampiran per email.`, 'files');
	const used = uploadSize(
		body,
		[...files, ...(forwarded?.files ?? [])].map((f) => ({ size: f.data.byteLength }))
	);
	const plan = planFiles(uploads, Math.max(0, EMAIL_ATTACH_BUDGET - used));
	const uploadedAttachments: SendFile[] = await Promise.all(
		plan.attach.map(async (r) => ({
			filename: r.filename,
			contentType: r.contentType,
			data: await needStorage(deps).read(r.key),
			fileId: r.id
		}))
	);
	const fileExpiry = new Date(Date.now() + EMAIL_FILE_LINK_DAYS * 86_400_000);
	// The link's code is saved before sending, so the email never carries a link that does not work
	const linked = await Promise.all(
		plan.link.map(async (r) => {
			if (!deps.appUrl) throw new Error('appUrl is not configured for download links');
			const token = r.token ?? newFileToken();
			const expiresAt = r.expiresAt ?? fileExpiry;
			if (!r.token)
				await db.update(emailFile).set({ token, expiresAt }).where(eq(emailFile.id, r.id));
			return { row: r, expiresAt, url: `${deps.appUrl}/f/${token}` };
		})
	);
	const fileLinks = linked.map((l) => ({
		filename: l.row.filename,
		size: l.row.size,
		url: l.url
	}));
	const linksUntil = linked[0]?.expiresAt ?? fileExpiry;

	const subject = forwarded
		? input.subject.trim() || forwardSubject(forwarded.message.subject)
		: parent
			? input.subject.trim() || replySubject(parent.subject)
			: input.subject.trim();
	if (!subject) throw new ServiceError('Isi subjek email.', 'subject');
	const composed = composeEmail({
		body: emptyBody ? '' : body,
		signature: await emailSignature(db, userId, deps),
		parent: parent
			? {
					from: formatAddress({ name: parent.fromName, email: parent.fromEmail }),
					sentAt: parent.sentAt,
					text: parent.text ?? (parent.html ? htmlToText(parent.html) : '')
				}
			: undefined,
		extra: fileLinks.length
			? {
					html: fileLinksHtml(fileLinks, linksUntil),
					text: fileLinksText(fileLinks, linksUntil)
				}
			: undefined
	});
	let text = composed.text.trimStart();
	let html = composed.html;
	if (forwarded) {
		const m = forwarded.message;
		const original = {
			from: formatAddress({ name: m.fromName, email: m.fromEmail }),
			to: m.to,
			cc: m.cc,
			sentAt: m.sentAt,
			subject: m.subject,
			text: m.text ?? (m.html ? htmlToText(m.html) : ''),
			html: m.html
		};
		text = `${text}\n\n${forwardText(original)}`;
		html = `${html}${forwardHtml(original)}`;
	}
	// Forwarded files come from Resend, not from the browser: they don't count toward the upload limit
	const allFiles = [...files, ...uploadedAttachments, ...(forwarded?.files ?? [])];
	const domain = deps.from.email.split('@')[1];
	const messageId = `<${randomUUID()}@${domain}>`;
	const references = parent ? replyReferences(parent) : [];
	const headers: Record<string, string> = { 'Message-ID': messageId };
	if (parent?.messageId) headers['In-Reply-To'] = parent.messageId;
	if (references.length) headers['References'] = references.join(' ');

	const to = input.to.map(formatAddress);
	const cc = input.cc.map(formatAddress);
	const inline = embedImages(html);
	const resendId = await deps.send({
		to,
		cc,
		subject,
		text,
		html: inline.html,
		headers,
		idempotencyKey: `email-${input.key}`,
		attachments: [
			...allFiles.map((f) => ({
				filename: f.filename,
				content: Buffer.from(f.data).toString('base64'),
				contentType: f.contentType || undefined
			})),
			...inline.images
		]
	});
	const attachments: EmailAttachment[] = [
		...allFiles.map((f, i) => ({
			id: `out-${i + 1}`,
			filename: f.filename,
			contentType: f.contentType || 'application/octet-stream',
			size: f.data.byteLength,
			inline: false,
			...(f.fileId ? { fileId: f.fileId } : {})
		})),
		...linked.map((l, i) => ({
			id: `link-${i + 1}`,
			filename: l.row.filename,
			contentType: l.row.contentType,
			size: l.row.size,
			inline: false,
			fileId: l.row.id,
			link: true
		}))
	];

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ id: emailMessage.id, threadId: emailMessage.threadId })
			.from(emailMessage)
			.where(eq(emailMessage.resendId, resendId));
		// Same key twice: Resend sent it once and returned the same id
		if (existing) return { ...existing, forwarded: !!forwarded };

		const id = randomUUID();
		const threadId = parent?.threadId ?? id;
		// A forward stays with the client of the conversation it came from
		const clientId =
			(parent ? await threadClient(tx, threadId) : null) ??
			(forwarded ? await threadClient(tx, forwarded.message.threadId) : null) ??
			(
				await contactByEmail(
					tx,
					[...input.to, ...input.cc].map((a) => a.email)
				)
			)?.clientId ??
			null;
		const snippet =
			(emptyBody ? '' : snippetOf(htmlToText(body))) || (forwarded?.message.snippet ?? '');
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
			attachments,
			clientId,
			userId,
			readAt: now,
			sentAt: now
		});
		// The uploads now belong to this email; attached ones are kept as long as links would be
		if (uploads.length)
			await tx
				.update(emailFile)
				.set({ status: 'sent', emailId: id })
				.where(
					inArray(
						emailFile.id,
						uploads.map((u) => u.id)
					)
				);
		if (plan.attach.length)
			await tx
				.update(emailFile)
				.set({ expiresAt: fileExpiry })
				.where(
					and(
						inArray(
							emailFile.id,
							plan.attach.map((u) => u.id)
						),
						isNull(emailFile.expiresAt)
					)
				);
		if (parent) {
			await markThread(tx, threadId, true);
			await restoreThread(tx, threadId);
		}
		if (clientId)
			await logActivity(tx, {
				clientId,
				type: 'email',
				body: timelineBody(forwarded ? 'forward' : 'out', subject, snippet),
				meta: {
					emailId: id,
					threadId,
					direction: 'out',
					...(forwarded ? { forwardOf: forwarded.message.id } : {})
				},
				userId
			});
		return { id, threadId, forwarded: !!forwarded };
	});
}

export const INBOX_FILTERS = ['all', 'unread', 'client', 'none', 'sent', 'trash'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

const searchPattern = (q?: string) => (q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null);

/**
 * One row per thread: the live ones, or the ones in Sampah (a thread moves there whole), with an
 * optional search on their messages
 */
function threadSummary(db: DbOrTx, trash: boolean, like: string | null) {
	return db
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
			),
			deletedAt: sql<Date | null>`max(${emailMessage.deletedAt})`.as('thread_deleted_at')
		})
		.from(emailMessage)
		.where(
			and(
				trash ? isNotNull(emailMessage.deletedAt) : isNull(emailMessage.deletedAt),
				like
					? or(
							ilike(emailMessage.subject, like),
							ilike(emailMessage.fromEmail, like),
							ilike(emailMessage.fromName, like),
							ilike(emailMessage.snippet, like)
						)
					: undefined
			)
		)
		.groupBy(emailMessage.threadId)
		.as('t');
}

/** Counts for the filter chips, Sampah included; a search narrows them like the list */
export async function threadCounts(db: DbOrTx, q?: string) {
	const like = searchPattern(q);
	const t = threadSummary(db, false, like);
	const trashed = threadSummary(db, true, like);
	const [[counts], [inTrash]] = await Promise.all([
		db
			.select({
				all: sql<number>`count(*)::int`,
				unread: sql<number>`(count(*) filter (where ${t.unread} > 0))::int`,
				client: sql<number>`(count(*) filter (where ${t.clientId} is not null))::int`,
				none: sql<number>`(count(*) filter (where ${t.clientId} is null))::int`,
				sent: sql<number>`(count(*) filter (where ${t.hasOut}))::int`
			})
			.from(t),
		db.select({ n: sql<number>`count(*)::int` }).from(trashed)
	]);
	return { ...counts, trash: inTrash?.n ?? 0 };
}

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
	const t = threadSummary(db, filter === 'trash', searchPattern(q));

	const where = {
		all: undefined,
		unread: sql`${t.unread} > 0`,
		client: sql`${t.clientId} is not null`,
		none: sql`${t.clientId} is null`,
		sent: sql`${t.hasOut}`,
		trash: undefined
	}[filter];

	const [threads, counts] = await Promise.all([
		db
			.select({
				threadId: t.threadId,
				lastAt: t.lastAt,
				count: t.count,
				unread: t.unread,
				clientId: t.clientId,
				deletedAt: t.deletedAt
			})
			.from(t)
			.where(where)
			.orderBy(desc(t.lastAt))
			.limit(pageSize)
			.offset((Math.max(1, page) - 1) * pageSize),
		threadCounts(db, q)
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
			deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
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
			deletedAt: emailMessage.deletedAt,
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
	// A thread moves to Sampah whole: any message's date is the thread's
	const deletedAt = messages.find((m) => m.deletedAt)?.deletedAt ?? null;
	return { threadId, messages, client: c ?? null, deletedAt };
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
		.where(
			and(
				eq(emailMessage.direction, 'in'),
				isNull(emailMessage.readAt),
				isNull(emailMessage.deletedAt)
			)
		);
	return r?.n ?? 0;
}

/**
 * Hapus: the whole conversation moves to Sampah. It stays readable there and on the client
 * timeline, and is deleted for good after TRASH_DAYS (purgeTrash).
 */
export async function trashThread(db: DbOrTx, threadId: string, userId: string) {
	const rows = await db
		.update(emailMessage)
		.set({ deletedAt: new Date(), deletedBy: userId })
		.where(and(eq(emailMessage.threadId, threadId), isNull(emailMessage.deletedAt)))
		.returning({ id: emailMessage.id });
	if (!rows.length)
		throw new ServiceError('Percakapan email tidak ditemukan atau sudah di Sampah.');
}

/** Pulihkan from Sampah (also when a new message arrives in the conversation) */
export async function restoreThread(db: DbOrTx, threadId: string) {
	await db
		.update(emailMessage)
		.set({ deletedAt: null, deletedBy: null })
		.where(and(eq(emailMessage.threadId, threadId), isNotNull(emailMessage.deletedAt)));
}

/**
 * Hapus permanen, only from Sampah. The timeline entries stay (they record what happened); uploaded
 * files keep their own expiry and are removed by the nightly cleanup.
 */
export async function deleteThreadForever(db: DbOrTx, threadId: string) {
	const rows = await db
		.delete(emailMessage)
		.where(and(eq(emailMessage.threadId, threadId), isNotNull(emailMessage.deletedAt)))
		.returning({ id: emailMessage.id });
	if (!rows.length) throw new ServiceError('Percakapan ini tidak ada di Sampah.');
}

/** Nightly: conversations in Sampah longer than TRASH_DAYS; `all` = Kosongkan Sampah now */
export async function purgeTrash(db: DbOrTx, { now = new Date(), all = false } = {}) {
	const before = new Date(now.getTime() - TRASH_DAYS * 86_400_000);
	const rows = await db
		.delete(emailMessage)
		.where(
			all
				? isNotNull(emailMessage.deletedAt)
				: and(isNotNull(emailMessage.deletedAt), lt(emailMessage.deletedAt, before))
		)
		.returning({ threadId: emailMessage.threadId });
	return { threads: new Set(rows.map((r) => r.threadId)).size, messages: rows.length };
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

/**
 * What is needed to fetch a fresh attachment link from Resend; null when it is not ours. A sent
 * file is found by name (`nth` = how many earlier files had the same name), because Resend gives
 * sent attachments ids of its own.
 */
export async function attachmentSource(db: DbOrTx, emailId: string, attachmentId: string) {
	const [m] = await db
		.select({
			resendId: emailMessage.resendId,
			direction: emailMessage.direction,
			attachments: emailMessage.attachments,
			sentAt: emailMessage.sentAt
		})
		.from(emailMessage)
		.where(eq(emailMessage.id, emailId));
	const index = m?.attachments.findIndex((a) => a.id === attachmentId) ?? -1;
	if (!m || index < 0) return null;
	const file = m.attachments[index];
	return {
		resendId: m.resendId,
		direction: m.direction,
		sentAt: m.sentAt,
		filename: file.filename,
		nth: m.attachments.slice(0, index).filter((a) => a.filename === file.filename).length,
		/** Uploaded through the bucket: downloaded from there */
		fileId: file.fileId ?? null
	};
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
