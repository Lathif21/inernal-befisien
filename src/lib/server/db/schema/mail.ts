// Email inbox (P3-08): mail received through Resend Inbound and replies sent from the CRM.
// Relative imports only: shared with Trigger.dev.
import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { client, contact } from './crm';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const EMAIL_DIRECTIONS = ['in', 'out'] as const;

export type EmailAttachment = {
	/** Resend attachment id; the download link is fetched fresh (valid 1 hour) */
	id: string;
	filename: string;
	contentType: string;
	size: number;
	/** Inline images (signature logos) are not listed as attachments */
	inline: boolean;
	/** Uploaded through the bucket (email_file): downloaded from there, not from Resend */
	fileId?: string;
	/** Too big to attach: the email carried a download link (/f/<token>) instead */
	link?: boolean;
};

export const EMAIL_FILE_STATUSES = ['uploading', 'sent', 'deleted'] as const;

/**
 * A file uploaded in the write / reply drawer straight to the Neon bucket `email-files`. Sent as an
 * attachment (≤ 25 MB together) or as a download link `/f/<token>` until `expires_at`; the daily
 * cleanup task deletes the object after that, and unsent uploads after a day.
 */
export const emailFile = pgTable(
	'email_file',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Object key in the bucket */
		key: text('key').notNull().unique(),
		filename: text('filename').notNull(),
		contentType: text('content_type').notNull(),
		/** Bytes (what the browser said; checked against the bucket when sent) */
		size: bigint('size', { mode: 'number' }).notNull(),
		status: text('status', { enum: EMAIL_FILE_STATUSES }).notNull().default('uploading'),
		/** The email it went out with */
		emailId: uuid('email_id').references(() => emailMessage.id, { onDelete: 'set null' }),
		/** Attached to a saved draft: kept until the draft is sent or thrown away */
		draftId: uuid('draft_id').references(() => emailDraft.id, { onDelete: 'set null' }),
		/** Unguessable code in the download link */
		token: text('token').unique(),
		/** The link stops working and the object is deleted after this */
		expiresAt: tstz('expires_at'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: tstz('created_at').defaultNow().notNull()
	},
	(t) => [
		index('email_file_status_idx').on(t.status, t.expiresAt),
		check('email_file_status', sql`${t.status} in ('uploading', 'sent', 'deleted')`),
		check('email_file_size_positive', sql`${t.size} > 0`)
	]
);

export const emailMessage = pgTable(
	'email_message',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		direction: text('direction', { enum: EMAIL_DIRECTIONS }).notNull(),
		/** Resend's id of the received or sent email: a replayed webhook stores nothing twice */
		resendId: text('resend_id').notNull().unique(),
		/** RFC 5322 Message-ID with angle brackets; replies point at it */
		messageId: text('message_id'),
		inReplyTo: text('in_reply_to'),
		/** Message-IDs of the earlier messages, oldest first */
		references: text('references')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		/** The thread's first message id (its own id for a new thread) */
		threadId: uuid('thread_id').notNull(),
		/** Lower-case address */
		fromEmail: text('from_email').notNull(),
		fromName: text('from_name'),
		/** "Name <address>" or plain addresses, as received */
		to: text('to')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		cc: text('cc')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		/** Where a reply goes (Reply-To, else From) */
		replyTo: text('reply_to'),
		subject: text('subject').notNull().default(''),
		text: text('text'),
		/** Shown only inside a sandboxed iframe (no scripts, remote images blocked by default) */
		html: text('html'),
		/** First words of the body for lists, Telegram and the timeline */
		snippet: text('snippet').notNull().default(''),
		attachments: jsonb('attachments').$type<EmailAttachment[]>().notNull().default([]),
		/** Newsletters and automated mail (List-Unsubscribe, Precedence: bulk): no Telegram alert */
		bulk: boolean('bulk').notNull().default(false),
		clientId: uuid('client_id').references(() => client.id, { onDelete: 'set null' }),
		contactId: uuid('contact_id').references(() => contact.id, { onDelete: 'set null' }),
		/** Who sent it from the CRM (outgoing only) */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		/** Incoming mail is unread until someone opens the thread; outgoing is read when sent */
		readAt: tstz('read_at'),
		/** The Date header (or when Resend received it) */
		sentAt: tstz('sent_at').notNull(),
		/** In Sampah since (the whole thread at once); deleted for good after TRASH_DAYS */
		deletedAt: tstz('deleted_at'),
		deletedBy: text('deleted_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: tstz('created_at').defaultNow().notNull()
	},
	(t) => [
		index('email_message_thread_idx').on(t.threadId, t.sentAt),
		index('email_message_sent_idx').on(t.sentAt.desc()),
		index('email_message_message_id_idx').on(t.messageId),
		index('email_message_client_idx').on(t.clientId),
		index('email_message_unread_idx')
			.on(t.threadId)
			.where(sql`${t.direction} = 'in' and ${t.readAt} is null`),
		index('email_message_deleted_idx')
			.on(t.deletedAt)
			.where(sql`${t.deletedAt} is not null`),
		check('email_message_direction', sql`${t.direction} in ('in', 'out')`)
	]
);

export const EMAIL_DRAFT_STATUSES = ['draft', 'scheduled', 'sending', 'failed'] as const;

/**
 * An email being written (saved by the drawer while typing) or waiting to be sent at
 * `scheduled_at` by the Trigger.dev task `email-scheduled-send`. Only its writer sees it. Sent =
 * the row is deleted and the email is in email_message.
 */
export const emailDraft = pgTable(
	'email_draft',
	{
		/** Made by the drawer when it opens, so every save of the same email updates one row */
		id: uuid('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** A reply in this thread (the thread's first message id); null = a new email */
		threadId: uuid('thread_id').references(() => emailMessage.id, { onDelete: 'cascade' }),
		/** Teruskan: this email goes under the message */
		forwardEmailId: uuid('forward_email_id').references(() => emailMessage.id, {
			onDelete: 'set null'
		}),
		/** Attachment ids of the forwarded email ticked to go along */
		forwardFiles: text('forward_files')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		/** As typed (checked when it is sent or scheduled, not when it is saved) */
		to: text('to').notNull().default(''),
		cc: text('cc').notNull().default(''),
		subject: text('subject').notNull().default(''),
		/** The editor's HTML, pictures as `data:` sources */
		body: text('body').notNull().default(''),
		/** First words of the body for the Draf list */
		snippet: text('snippet').notNull().default(''),
		status: text('status', { enum: EMAIL_DRAFT_STATUSES }).notNull().default('draft'),
		scheduledAt: tstz('scheduled_at'),
		/** The delayed Trigger.dev run, cancelled when the schedule is */
		runId: text('run_id'),
		/** Why a scheduled send failed (Indonesian, shown in Terjadwal) */
		error: text('error'),
		createdAt: tstz('created_at').defaultNow().notNull(),
		updatedAt: tstz('updated_at').defaultNow().notNull()
	},
	(t) => [
		index('email_draft_user_idx').on(t.userId, t.status, t.updatedAt.desc()),
		index('email_draft_thread_idx').on(t.threadId),
		check('email_draft_status', sql`${t.status} in ('draft', 'scheduled', 'sending', 'failed')`),
		check(
			'email_draft_scheduled_at',
			sql`${t.status} not in ('scheduled', 'sending') or ${t.scheduledAt} is not null`
		)
	]
);
