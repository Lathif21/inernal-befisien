// Finance tables from docs/02-DATA-MODEL.md. invoice / invoice_item and category.is_overhead come in Phase 2.
import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	check,
	date,
	index,
	integer,
	numeric,
	pgTable,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { client, project, timestamps } from './crm';
import { invoiceStatus, paymentMethod, txnStatus, txnType } from './enums';

export const category = pgTable(
	'category',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		type: txnType('type').notNull(),
		name: text('name').notNull(),
		sort: smallint('sort').notNull().default(0),
		...timestamps
	},
	(t) => [uniqueIndex('category_type_name_idx').on(t.type, t.name)]
);

export const transaction = pgTable(
	'transaction',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		type: txnType('type').notNull(),
		status: txnStatus('status').notNull().default('paid'),
		/** Paid date, or expected date when planned */
		date: date('date').notNull(),
		/** Whole IDR, always positive; direction comes from `type` */
		amount: bigint('amount', { mode: 'number' }).notNull(),
		categoryId: uuid('category_id').references(() => category.id),
		/** Required in Phase 1; becomes nullable for overhead costs in P2-08 */
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id),
		projectId: uuid('project_id').references(() => project.id),
		/** P2-07: a payment against this invoice */
		invoiceId: uuid('invoice_id').references((): AnyPgColumn => invoice.id),
		description: text('description'),
		method: paymentMethod('method'),
		reference: text('reference'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [
		check('transaction_amount_positive', sql`${t.amount} > 0`),
		index('transaction_client_date_idx').on(t.clientId, t.date),
		index('transaction_date_type_status_idx').on(t.date, t.type, t.status),
		index('transaction_project_idx').on(t.projectId)
	]
);

export const categoryRelations = relations(category, ({ many }) => ({
	transactions: many(transaction)
}));

export const transactionRelations = relations(transaction, ({ one }) => ({
	category: one(category, { fields: [transaction.categoryId], references: [category.id] }),
	client: one(client, { fields: [transaction.clientId], references: [client.id] }),
	project: one(project, { fields: [transaction.projectId], references: [project.id] }),
	createdByUser: one(user, { fields: [transaction.createdBy], references: [user.id] })
}));

// ---------- invoices (Phase 2, docs/02-DATA-MODEL.md) ----------

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Last invoice number per month ("2026-10" → 7). Claimed with one atomic upsert, so two invoices
 * created at the same moment never get the same number (services/invoices.ts).
 */
export const invoiceCounter = pgTable('invoice_counter', {
	period: text('period').primaryKey(),
	last: integer('last').notNull()
});

export const invoice = pgTable(
	'invoice',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** INV/BEF/{YYYY}/{MM}/{seq}, from the issue month */
		number: text('number').notNull().unique(),
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id),
		projectId: uuid('project_id').references(() => project.id),
		issueDate: date('issue_date').notNull(),
		dueDate: date('due_date').notNull(),
		status: invoiceStatus('status').notNull().default('draft'),
		/** Whole IDR; totals are computed on the server (lib/invoice.ts), never trusted from the browser */
		subtotal: bigint('subtotal', { mode: 'number' }).notNull().default(0),
		/** Percent; 0 = PPN off */
		ppnRate: numeric('ppn_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(11),
		ppnAmount: bigint('ppn_amount', { mode: 'number' }).notNull().default(0),
		/** Percent; 0 = PPh 23 off (withheld by the client) */
		pph23Rate: numeric('pph23_rate', { precision: 5, scale: 2, mode: 'number' })
			.notNull()
			.default(2),
		pph23Amount: bigint('pph23_amount', { mode: 'number' }).notNull().default(0),
		/** Invoice face value = subtotal + PPN */
		total: bigint('total', { mode: 'number' }).notNull().default(0),
		notes: text('notes'),
		sentAt: tstz('sent_at'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [
		index('invoice_client_idx').on(t.clientId),
		index('invoice_status_due_idx').on(t.status, t.dueDate),
		check('invoice_amounts_not_negative', sql`${t.subtotal} >= 0 and ${t.total} >= 0`)
	]
);

export const invoiceItem = pgTable(
	'invoice_item',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		invoiceId: uuid('invoice_id')
			.notNull()
			.references(() => invoice.id, { onDelete: 'cascade' }),
		description: text('description').notNull(),
		qty: numeric('qty', { precision: 10, scale: 2, mode: 'number' }).notNull().default(1),
		unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
		/** round(qty × unit_price), whole IDR */
		amount: bigint('amount', { mode: 'number' }).notNull(),
		sort: smallint('sort').notNull().default(0)
	},
	(t) => [index('invoice_item_invoice_idx').on(t.invoiceId, t.sort)]
);
