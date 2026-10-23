CREATE TYPE "public"."ai_kind" AS ENUM('risk', 'opportunity', 'pipeline');--> statement-breakpoint
CREATE TYPE "public"."ai_status" AS ENUM('new', 'accepted', 'dismissed', 'expired');--> statement-breakpoint
CREATE TABLE "ai_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid,
	"project_id" uuid,
	"plan_id" uuid,
	"kind" "ai_kind" NOT NULL,
	"insight" text NOT NULL,
	"proposed_action" text NOT NULL,
	"proposed_due_at" timestamp with time zone,
	"status" "ai_status" DEFAULT 'new' NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "ai_input_hash" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "ai_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_plan_id_strategy_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."strategy_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestion_status_created_idx" ON "ai_suggestion" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_suggestion_client_idx" ON "ai_suggestion" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_from_suggestion_id_ai_suggestion_id_fk" FOREIGN KEY ("from_suggestion_id") REFERENCES "public"."ai_suggestion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_plan" ADD CONSTRAINT "strategy_plan_from_suggestion_id_ai_suggestion_id_fk" FOREIGN KEY ("from_suggestion_id") REFERENCES "public"."ai_suggestion"("id") ON DELETE set null ON UPDATE no action;