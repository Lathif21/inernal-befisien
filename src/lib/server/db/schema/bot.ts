// Telegram input (P2-10): what the bot understood from a message, waiting for Simpan / Batal.
// Relative imports only: shared with Trigger.dev.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const TELEGRAM_DRAFT_STATUSES = ['pending', 'saved', 'cancelled', 'replaced'] as const;

export const telegramDraft = pgTable(
	'telegram_draft',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		chatId: text('chat_id').notNull(),
		/** lead | step | move | plan | note, or question (incomplete, waiting for an answer; no buttons) */
		kind: text('kind').notNull(),
		/** The checked draft that Simpan writes (services/telegram-input.ts `Draft`) */
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
		/** The AI answer with real ids, so a correction can start from it */
		answer: jsonb('answer').$type<Record<string, unknown>>().notNull(),
		/** 'text' | 'voice' */
		source: text('source').notNull(),
		/** The message text or the transcript */
		input: text('input').notNull(),
		status: text('status', { enum: TELEGRAM_DRAFT_STATUSES }).notNull().default('pending'),
		/** The bot's preview message, whose buttons are removed once decided */
		messageId: integer('message_id'),
		expiresAt: tstz('expires_at').notNull(),
		decidedAt: tstz('decided_at'),
		createdAt: tstz('created_at').defaultNow().notNull()
	},
	(t) => [
		index('telegram_draft_chat_idx').on(t.chatId, t.createdAt.desc()),
		check(
			'telegram_draft_status',
			sql`${t.status} in ('pending', 'saved', 'cancelled', 'replaced')`
		)
	]
);
