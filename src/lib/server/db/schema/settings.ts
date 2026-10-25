// App-wide settings: company_profile (invoice PDF, P2-06) and app_settings (Saran AI schedule).
import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

/** One row (id = 1). Missing row = not filled in yet: the app shows example values. */
export const companyProfile = pgTable(
	'company_profile',
	{
		id: smallint('id').primaryKey().default(1),
		name: text('name').notNull(),
		address: text('address').notNull().default(''),
		/** Place in the signature line: "Surabaya, 24 Oktober 2026" */
		city: text('city').notNull().default(''),
		/** Normalised 628… */
		phone: text('phone'),
		email: text('email'),
		/** Digits only */
		npwp: text('npwp'),
		bankName: text('bank_name').notNull().default(''),
		bankAccountNumber: text('bank_account_number').notNull().default(''),
		bankAccountName: text('bank_account_name').notNull().default(''),
		signerName: text('signer_name').notNull().default(''),
		signerTitle: text('signer_title').notNull().default(''),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' })
	},
	(t) => [check('company_profile_single_row', sql`${t.id} = 1`)]
);

/**
 * App-wide settings (one row, id = 1). Saran AI: on / off and when the scheduled run happens
 * (src/lib/ai-schedule.ts). Missing row = the defaults (on, daily 06:30).
 */
export const appSettings = pgTable(
	'app_settings',
	{
		id: smallint('id').primaryKey().default(1),
		aiEnabled: boolean('ai_enabled').notNull().default(true),
		/** daily | weekly | monthly | manual */
		aiFrequency: text('ai_frequency').notNull().default('daily'),
		/** HH:MM in WIB, 30-minute steps */
		aiTime: text('ai_time').notNull().default('06:30'),
		/** 1 = Senin … 7 = Minggu (weekly) */
		aiWeekday: smallint('ai_weekday').notNull().default(1),
		/** 1–31 (monthly); a short month uses its last day */
		aiMonthDay: smallint('ai_month_day').notNull().default(1),
		/** When the scheduled run last started: a slot runs once */
		aiLastRunAt: timestamp('ai_last_run_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' })
	},
	(t) => [
		check('app_settings_single_row', sql`${t.id} = 1`),
		check(
			'app_settings_ai_frequency',
			sql`${t.aiFrequency} in ('daily', 'weekly', 'monthly', 'manual')`
		)
	]
);
