CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'meeting', 'whatsapp', 'email', 'stage_change', 'action_done', 'transaction', 'ai_accepted', 'system');--> statement-breakpoint
CREATE TYPE "public"."client_source" AS ENUM('website', 'referral', 'apollo', 'event', 'existing_network', 'other');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('prospect', 'active', 'inactive', 'archived');--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."industry" AS ENUM('manufacturing', 'energy', 'logistics', 'finance', 'education', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('transfer', 'cash', 'card', 'ewallet', 'other');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'achieved', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."project_stage" AS ENUM('onboarding', 'in_progress', 'review', 'done', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('ai_agent', 'automation', 'integration', 'dashboard_app', 'web_cms', 'energy_ai', 'other');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('planned', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'sales', 'finance');