// Postgres enums. The value lists live in src/lib/constants.ts (single source of truth with the UI labels).
// Relative import only: this file is shared with Trigger.dev.
import { pgEnum } from 'drizzle-orm/pg-core';
import {
	ACTIVITY_TYPES,
	AI_KINDS,
	AI_STATUSES,
	CLIENT_SOURCES,
	CLIENT_STATUSES,
	DEAL_STAGES,
	INDUSTRIES,
	INVOICE_STATUSES,
	PAYMENT_METHODS,
	PLAN_STATUSES,
	PROJECT_STAGES,
	SERVICE_TYPES,
	TXN_STATUSES,
	TXN_TYPES,
	USER_ROLES
} from '../../../constants';

export const userRole = pgEnum('user_role', USER_ROLES);
export const clientStatus = pgEnum('client_status', CLIENT_STATUSES);
export const clientSource = pgEnum('client_source', CLIENT_SOURCES);
export const industry = pgEnum('industry', INDUSTRIES);
export const dealStage = pgEnum('deal_stage', DEAL_STAGES);
export const projectStage = pgEnum('project_stage', PROJECT_STAGES);
export const serviceType = pgEnum('service_type', SERVICE_TYPES);
export const activityType = pgEnum('activity_type', ACTIVITY_TYPES);
export const planStatus = pgEnum('plan_status', PLAN_STATUSES);
export const txnType = pgEnum('txn_type', TXN_TYPES);
export const txnStatus = pgEnum('txn_status', TXN_STATUSES);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const aiKind = pgEnum('ai_kind', AI_KINDS);
export const aiStatus = pgEnum('ai_status', AI_STATUSES);
export const invoiceStatus = pgEnum('invoice_status', INVOICE_STATUSES);
