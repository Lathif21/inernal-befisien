// Email inbox (P3-08): mail received through Resend Inbound and replies sent from the CRM.
// Relative imports only: shared with Trigger.dev.
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
};

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
		check('email_message_direction', sql`${t.direction} in ('in', 'out')`)
	]
);
