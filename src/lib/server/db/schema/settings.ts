// App-wide settings. company_profile holds the details printed on invoices (P2-06).
import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';
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
