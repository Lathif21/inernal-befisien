import { pgEnum } from 'drizzle-orm/pg-core';

// Phase 1 enums from docs/02-DATA-MODEL.md. ai_* (P2-01) and invoice_status (P2-04) come later.

export const userRole = pgEnum('user_role', ['admin', 'sales', 'finance']);

export const clientStatus = pgEnum('client_status', ['prospect', 'active', 'inactive', 'archived']);

export const clientSource = pgEnum('client_source', [
	'website',
	'referral',
	'apollo',
	'event',
	'existing_network',
	'other'
]);

export const industry = pgEnum('industry', [
	'manufacturing',
	'energy',
	'logistics',
	'finance',
	'education',
	'other'
]);

export const dealStage = pgEnum('deal_stage', [
	'lead',
	'contacted',
	'meeting',
	'proposal',
	'negotiation',
	'won',
	'lost'
]);

export const projectStage = pgEnum('project_stage', [
	'onboarding',
	'in_progress',
	'review',
	'done',
	'maintenance'
]);

export const serviceType = pgEnum('service_type', [
	'ai_agent',
	'automation',
	'integration',
	'dashboard_app',
	'web_cms',
	'energy_ai',
	'other'
]);

export const activityType = pgEnum('activity_type', [
	'note',
	'call',
	'meeting',
	'whatsapp',
	'email',
	'stage_change',
	'action_done',
	'transaction',
	'ai_accepted',
	'system'
]);

export const planStatus = pgEnum('plan_status', ['active', 'achieved', 'dropped']);

export const txnType = pgEnum('txn_type', ['income', 'expense']);

export const txnStatus = pgEnum('txn_status', ['planned', 'paid', 'cancelled']);

export const paymentMethod = pgEnum('payment_method', [
	'transfer',
	'cash',
	'card',
	'ewallet',
	'other'
]);
