// Finance tables from docs/02-DATA-MODEL.md. invoice / invoice_item and category.is_overhead come in Phase 2.
import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	check,
	date,
	index,
	pgTable,
	smallint,
	text,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { client, project, timestamps } from './crm';
import { paymentMethod, txnStatus, txnType } from './enums';

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
