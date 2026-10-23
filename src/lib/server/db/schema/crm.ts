// CRM tables from docs/02-DATA-MODEL.md. Business rules live in services/, not here.
import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	date,
	index,
	jsonb,
	pgTable,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
	activityType,
	aiKind,
	aiStatus,
	clientSource,
	clientStatus,
	dealStage,
	industry,
	planStatus,
	projectStage,
	serviceType
} from './enums';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const timestamps = {
	createdAt: tstz('created_at').defaultNow().notNull(),
	updatedAt: tstz('updated_at')
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date())
};

/** Better Auth user ids are text */
const userRef = (name: string) => text(name).references(() => user.id, { onDelete: 'set null' });

export const client = pgTable(
	'client',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		industry: industry('industry'),
		status: clientStatus('status').notNull().default('prospect'),
		source: clientSource('source'),
		address: text('address'),
		city: text('city'),
		website: text('website'),
		npwp: text('npwp'),
		notes: text('notes'),
		ownerId: userRef('owner_id'),
		archivedAt: tstz('archived_at'),
		/** What the AI last looked at (P2-01): a run with the same facts is skipped */
		aiInputHash: text('ai_input_hash'),
		aiCheckedAt: tstz('ai_checked_at'),
		...timestamps
	},
	(t) => [
		index('client_name_lower_idx').on(sql`lower(${t.name})`),
		index('client_status_idx').on(t.status)
	]
);

export const contact = pgTable(
	'contact',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		position: text('position'),
		/** Normalised 628… */
		phone: text('phone'),
		email: text('email'),
		isPrimary: boolean('is_primary').notNull().default(false),
		...timestamps
	},
	(t) => [
		index('contact_client_idx').on(t.clientId),
		// At most one primary contact per client
		uniqueIndex('contact_one_primary_idx')
			.on(t.clientId)
			.where(sql`${t.isPrimary}`)
	]
);

export const deal = pgTable(
	'deal',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id),
		title: text('title').notNull(),
		serviceType: serviceType('service_type'),
		stage: dealStage('stage').notNull().default('lead'),
		/** Fractional index inside the stage column */
		position: text('position').notNull(),
		valueEstimate: bigint('value_estimate', { mode: 'number' }),
		probability: smallint('probability'),
		expectedClose: date('expected_close'),
		ownerId: userRef('owner_id'),
		lostReason: text('lost_reason'),
		stageChangedAt: tstz('stage_changed_at').defaultNow().notNull(),
		wonAt: tstz('won_at'),
		lostAt: tstz('lost_at'),
		...timestamps
	},
	(t) => [
		index('deal_stage_pos_idx').on(t.stage, t.position),
		index('deal_client_idx').on(t.clientId),
		check(
			'deal_lost_needs_reason',
			sql`${t.stage} <> 'lost' or coalesce(length(trim(${t.lostReason})), 0) > 0`
		),
		check(
			'deal_probability_range',
			sql`${t.probability} is null or ${t.probability} between 0 and 100`
		),
		check('deal_value_not_negative', sql`${t.valueEstimate} is null or ${t.valueEstimate} >= 0`)
	]
);

export const project = pgTable(
	'project',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id),
		/** Set when created from a won deal; one project per deal */
		dealId: uuid('deal_id')
			.unique()
			.references(() => deal.id),
		name: text('name').notNull(),
		serviceType: serviceType('service_type'),
		stage: projectStage('stage').notNull().default('onboarding'),
		position: text('position').notNull(),
		/** IDR, excluding tax */
		contractValue: bigint('contract_value', { mode: 'number' }),
		startDate: date('start_date'),
		targetEndDate: date('target_end_date'),
		finishedAt: tstz('finished_at'),
		ownerId: userRef('owner_id'),
		stageChangedAt: tstz('stage_changed_at').defaultNow().notNull(),
		...timestamps
	},
	(t) => [
		index('project_stage_pos_idx').on(t.stage, t.position),
		index('project_client_idx').on(t.clientId),
		check(
			'project_contract_not_negative',
			sql`${t.contractValue} is null or ${t.contractValue} >= 0`
		)
	]
);

export const strategyPlan = pgTable(
	'strategy_plan',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id),
		dealId: uuid('deal_id').references(() => deal.id),
		/** Set when the deal is won and the plan moves to the project (deal_id kept for history) */
		projectId: uuid('project_id').references(() => project.id),
		goal: text('goal').notNull(),
		targetDate: date('target_date'),
		status: planStatus('status').notNull().default('active'),
		ownerId: userRef('owner_id'),
		fromSuggestionId: uuid('from_suggestion_id').references((): AnyPgColumn => aiSuggestion.id, {
			onDelete: 'set null'
		}),
		notes: text('notes'),
		...timestamps
	},
	(t) => [
		index('strategy_plan_status_target_idx').on(t.status, t.targetDate),
		index('strategy_plan_client_idx').on(t.clientId)
	]
);

/** A step. Exactly one of deal_id / project_id is set. */
export const action = pgTable(
	'action',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		dealId: uuid('deal_id').references(() => deal.id, { onDelete: 'cascade' }),
		projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
		/** null = quick step with no plan */
		planId: uuid('plan_id').references(() => strategyPlan.id, { onDelete: 'set null' }),
		title: text('title').notNull(),
		/** Date and time, entered in WIB */
		dueAt: tstz('due_at').notNull(),
		allDay: boolean('all_day').notNull().default(false),
		/** Order inside a plan */
		sort: smallint('sort').notNull().default(0),
		assigneeId: userRef('assignee_id'),
		doneAt: tstz('done_at'),
		doneBy: userRef('done_by'),
		fromSuggestionId: uuid('from_suggestion_id').references((): AnyPgColumn => aiSuggestion.id, {
			onDelete: 'set null'
		}),
		...timestamps
	},
	(t) => [
		check('action_one_parent', sql`num_nonnulls(${t.dealId}, ${t.projectId}) = 1`),
		index('action_open_assignee_due_idx')
			.on(t.assigneeId, t.dueAt)
			.where(sql`${t.doneAt} is null`),
		index('action_open_deal_due_idx')
			.on(t.dealId, t.dueAt)
			.where(sql`${t.doneAt} is null`),
		index('action_open_project_due_idx')
			.on(t.projectId, t.dueAt)
			.where(sql`${t.doneAt} is null`),
		index('action_plan_sort_idx').on(t.planId, t.sort)
	]
);

export const activity = pgTable(
	'activity',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** Always set, so the client timeline is one query */
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id, { onDelete: 'cascade' }),
		dealId: uuid('deal_id').references(() => deal.id, { onDelete: 'set null' }),
		projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
		type: activityType('type').notNull(),
		body: text('body'),
		meta: jsonb('meta').$type<Record<string, unknown>>(),
		/** null for system events */
		userId: userRef('user_id'),
		occurredAt: tstz('occurred_at').defaultNow().notNull(),
		...timestamps
	},
	(t) => [index('activity_client_occurred_idx').on(t.clientId, t.occurredAt.desc())]
);

/** AI suggestion (P2-01, docs/02-DATA-MODEL.md). Only ever becomes a step or plan when a person accepts it. */
export const aiSuggestion = pgTable(
	'ai_suggestion',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		clientId: uuid('client_id')
			.notNull()
			.references(() => client.id, { onDelete: 'cascade' }),
		dealId: uuid('deal_id').references(() => deal.id, { onDelete: 'set null' }),
		projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
		planId: uuid('plan_id').references(() => strategyPlan.id, { onDelete: 'set null' }),
		kind: aiKind('kind').notNull(),
		insight: text('insight').notNull(),
		proposedAction: text('proposed_action').notNull(),
		proposedDueAt: tstz('proposed_due_at'),
		status: aiStatus('status').notNull().default('new'),
		model: text('model').notNull(),
		inputHash: text('input_hash').notNull(),
		decidedBy: userRef('decided_by'),
		decidedAt: tstz('decided_at'),
		...timestamps
	},
	(t) => [
		index('ai_suggestion_status_created_idx').on(t.status, t.createdAt.desc()),
		index('ai_suggestion_client_idx').on(t.clientId)
	]
);

export const clientRelations = relations(client, ({ one, many }) => ({
	owner: one(user, { fields: [client.ownerId], references: [user.id] }),
	contacts: many(contact),
	deals: many(deal),
	projects: many(project),
	plans: many(strategyPlan),
	activities: many(activity)
}));

export const contactRelations = relations(contact, ({ one }) => ({
	client: one(client, { fields: [contact.clientId], references: [client.id] })
}));

export const dealRelations = relations(deal, ({ one, many }) => ({
	client: one(client, { fields: [deal.clientId], references: [client.id] }),
	owner: one(user, { fields: [deal.ownerId], references: [user.id] }),
	project: one(project, { fields: [deal.id], references: [project.dealId] }),
	actions: many(action),
	plans: many(strategyPlan),
	activities: many(activity)
}));

export const projectRelations = relations(project, ({ one, many }) => ({
	client: one(client, { fields: [project.clientId], references: [client.id] }),
	deal: one(deal, { fields: [project.dealId], references: [deal.id] }),
	owner: one(user, { fields: [project.ownerId], references: [user.id] }),
	actions: many(action),
	plans: many(strategyPlan),
	activities: many(activity)
}));

export const strategyPlanRelations = relations(strategyPlan, ({ one, many }) => ({
	client: one(client, { fields: [strategyPlan.clientId], references: [client.id] }),
	deal: one(deal, { fields: [strategyPlan.dealId], references: [deal.id] }),
	project: one(project, { fields: [strategyPlan.projectId], references: [project.id] }),
	owner: one(user, { fields: [strategyPlan.ownerId], references: [user.id] }),
	steps: many(action)
}));

export const actionRelations = relations(action, ({ one }) => ({
	deal: one(deal, { fields: [action.dealId], references: [deal.id] }),
	project: one(project, { fields: [action.projectId], references: [project.id] }),
	plan: one(strategyPlan, { fields: [action.planId], references: [strategyPlan.id] }),
	assignee: one(user, { fields: [action.assigneeId], references: [user.id] })
}));

export const activityRelations = relations(activity, ({ one }) => ({
	client: one(client, { fields: [activity.clientId], references: [client.id] }),
	deal: one(deal, { fields: [activity.dealId], references: [deal.id] }),
	project: one(project, { fields: [activity.projectId], references: [project.id] }),
	user: one(user, { fields: [activity.userId], references: [user.id] })
}));
