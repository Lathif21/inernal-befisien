// Domain vocabulary shared by the UI, services and the DB enums (schema/enums.ts imports the value lists).
// Client-safe: no server imports. UI copy is Bahasa Indonesia (docs/03-SCREENS.md, docs/06-DESIGN-SYSTEM.md).

export const DEAL_STAGES = [
	'lead',
	'contacted',
	'meeting',
	'proposal',
	'negotiation',
	'won',
	'lost'
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const PROJECT_STAGES = [
	'onboarding',
	'in_progress',
	'review',
	'done',
	'maintenance'
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const SERVICE_TYPES = [
	'ai_agent',
	'automation',
	'integration',
	'dashboard_app',
	'web_cms',
	'energy_ai',
	'other'
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const CLIENT_SOURCES = [
	'website',
	'referral',
	'apollo',
	'event',
	'existing_network',
	'other'
] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];

export const INDUSTRIES = [
	'manufacturing',
	'energy',
	'logistics',
	'finance',
	'education',
	'other'
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const CLIENT_STATUSES = ['prospect', 'active', 'inactive', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const ACTIVITY_TYPES = [
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
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PLAN_STATUSES = ['active', 'achieved', 'dropped'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** AI suggestions (P2-01): what kind of insight, and where it is in its life */
export const AI_KINDS = ['risk', 'opportunity', 'pipeline'] as const;
export type AiKind = (typeof AI_KINDS)[number];
export const AI_STATUSES = ['new', 'accepted', 'dismissed', 'expired'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const TXN_TYPES = ['income', 'expense'] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const TXN_STATUSES = ['planned', 'paid', 'cancelled'] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];

/** Invoices (P2-04): draft → sent → partial / paid; overdue is set by a daily job; void cancels */
export const INVOICE_STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['transfer', 'cash', 'card', 'ewallet', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const USER_ROLES = ['admin', 'sales', 'finance'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Chip = soft background + text classes; dot = column / funnel marker. Theme classes only. */
export type StageStyle = { label: string; chip: string; dot: string };

// The blue deepens toward closing so the board reads left to right (docs/06-DESIGN-SYSTEM.md)
export const DEAL_STAGE_META: Record<DealStage, StageStyle & { probability: number }> = {
	lead: { label: 'Lead', chip: 'bg-tint-2 text-ink-2', dot: 'bg-stage-lead', probability: 10 },
	contacted: {
		label: 'Dihubungi',
		chip: 'bg-tint text-accent-ink',
		dot: 'bg-stage-contacted',
		probability: 20
	},
	meeting: {
		label: 'Meeting / Discovery',
		chip: 'bg-stage-contacted/35 text-accent-hover',
		dot: 'bg-stage-meeting',
		probability: 40
	},
	proposal: {
		label: 'Proposal Terkirim',
		chip: 'bg-accent text-on-accent',
		dot: 'bg-stage-proposal',
		probability: 60
	},
	negotiation: {
		label: 'Negosiasi',
		chip: 'bg-navy text-on-accent',
		dot: 'bg-stage-negotiation',
		probability: 80
	},
	won: {
		label: 'Deal ✓',
		chip: 'bg-success-bg text-success',
		dot: 'bg-success-fill',
		probability: 100
	},
	lost: { label: 'Batal', chip: 'bg-danger-bg text-danger', dot: 'bg-danger-fill', probability: 0 }
};

/** Stages a deal can still move through; won / lost are terminal */
export const OPEN_DEAL_STAGES = [
	'lead',
	'contacted',
	'meeting',
	'proposal',
	'negotiation'
] as const satisfies readonly DealStage[];

export const PROJECT_STAGE_META: Record<ProjectStage, StageStyle> = {
	onboarding: { label: 'Onboarding', chip: 'bg-tint-2 text-ink-2', dot: 'bg-stage-contacted' },
	in_progress: { label: 'Dikerjakan', chip: 'bg-tint text-accent-ink', dot: 'bg-stage-meeting' },
	review: { label: 'Review / UAT', chip: 'bg-accent text-on-accent', dot: 'bg-stage-proposal' },
	done: { label: 'Selesai', chip: 'bg-success-bg text-success', dot: 'bg-success-fill' },
	maintenance: { label: 'Maintenance', chip: 'bg-navy text-on-accent', dot: 'bg-stage-negotiation' }
};

/** Stages where a card may have no open step (docs/02-DATA-MODEL.md rule 4) */
export const TERMINAL_STAGES: readonly (DealStage | ProjectStage)[] = ['won', 'lost', 'done'];

/** Stage offered by "Pindahkan ke …" after a step is done. Negosiasi has none: winning goes
    through the Deal ✓ prompt on the board. */
export const NEXT_DEAL_STAGE: Record<DealStage, DealStage | null> = {
	lead: 'contacted',
	contacted: 'meeting',
	meeting: 'proposal',
	proposal: 'negotiation',
	negotiation: null,
	won: null,
	lost: null
};

/** Project counterpart of NEXT_DEAL_STAGE. Selesai → Maintenance is a board move, not a step. */
export const NEXT_PROJECT_STAGE: Record<ProjectStage, ProjectStage | null> = {
	onboarding: 'in_progress',
	in_progress: 'review',
	review: 'done',
	done: null,
	maintenance: null
};

// Chip labels from docs/02-DATA-MODEL.md (they match the solutions on befisien.com)
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
	ai_agent: 'AI Agent',
	automation: 'Otomasi',
	integration: 'Integrasi',
	dashboard_app: 'Dashboard',
	web_cms: 'Web & CMS',
	energy_ai: 'AI Energi',
	other: 'Lainnya'
};

export const CLIENT_SOURCE_LABELS: Record<ClientSource, string> = {
	website: 'Website',
	referral: 'Referral',
	apollo: 'Apollo',
	event: 'Event',
	existing_network: 'Jaringan lama',
	other: 'Lainnya'
};

export const INDUSTRY_LABELS: Record<Industry, string> = {
	manufacturing: 'Manufaktur',
	energy: 'Energi',
	logistics: 'Logistik',
	finance: 'Keuangan',
	education: 'Pendidikan',
	other: 'Lainnya'
};

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
	prospect: 'Prospek',
	active: 'Aktif',
	inactive: 'Tidak aktif',
	archived: 'Diarsipkan'
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
	note: 'Catatan',
	call: 'Telepon',
	meeting: 'Meeting',
	whatsapp: 'WhatsApp',
	email: 'Email',
	stage_change: 'Pindah tahap',
	action_done: 'Langkah selesai',
	transaction: 'Transaksi',
	ai_accepted: 'Saran AI diterima',
	system: 'Sistem'
};

/** Types a person can log by hand in the activity composer */
export const MANUAL_ACTIVITY_TYPES = [
	'note',
	'call',
	'meeting',
	'whatsapp',
	'email'
] as const satisfies readonly ActivityType[];

export const AI_KIND_LABELS: Record<AiKind, string> = {
	risk: 'Risiko',
	opportunity: 'Peluang',
	pipeline: 'Pipeline'
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
	active: 'Aktif',
	achieved: 'Tercapai',
	dropped: 'Dibatalkan'
};

export const TXN_TYPE_LABELS: Record<TxnType, { long: string; short: string }> = {
	income: { long: 'Pemasukan', short: 'Masuk' },
	expense: { long: 'Pengeluaran', short: 'Keluar' }
};

export const TXN_STATUS_LABELS: Record<TxnStatus, string> = {
	paid: 'Sudah dibayar',
	planned: 'Direncanakan',
	cancelled: 'Dibatalkan'
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
	draft: 'Draf',
	sent: 'Terkirim',
	partial: 'Dibayar sebagian',
	paid: 'Lunas',
	overdue: 'Jatuh tempo',
	void: 'Dibatalkan'
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	transfer: 'Transfer',
	cash: 'Tunai',
	card: 'Kartu',
	ewallet: 'E-wallet',
	other: 'Lainnya'
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
	admin: 'Admin',
	sales: 'Sales',
	finance: 'Keuangan'
};

/** Reasons offered in the Batal modal (docs/03-SCREENS.md); "Lainnya" needs free text */
export const LOST_REASONS = [
	'Harga',
	'Timing',
	'Pilih kompetitor',
	'Tidak ada budget',
	'Tidak responsif',
	'Lainnya'
] as const;
