CREATE TABLE "action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"project_id" uuid,
	"plan_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"assignee_id" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	"from_suggestion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_one_parent" CHECK (num_nonnulls("action"."deal_id", "action"."project_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid,
	"project_id" uuid,
	"type" "activity_type" NOT NULL,
	"body" text,
	"meta" jsonb,
	"user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"industry" "industry",
	"status" "client_status" DEFAULT 'prospect' NOT NULL,
	"source" "client_source",
	"address" text,
	"city" text,
	"website" text,
	"npwp" text,
	"notes" text,
	"owner_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"service_type" "service_type",
	"stage" "deal_stage" DEFAULT 'lead' NOT NULL,
	"position" text NOT NULL,
	"value_estimate" bigint,
	"probability" smallint,
	"expected_close" date,
	"owner_id" text,
	"lost_reason" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_lost_needs_reason" CHECK ("deal"."stage" <> 'lost' or coalesce(length(trim("deal"."lost_reason")), 0) > 0),
	CONSTRAINT "deal_probability_range" CHECK ("deal"."probability" is null or "deal"."probability" between 0 and 100),
	CONSTRAINT "deal_value_not_negative" CHECK ("deal"."value_estimate" is null or "deal"."value_estimate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid,
	"name" text NOT NULL,
	"service_type" "service_type",
	"stage" "project_stage" DEFAULT 'onboarding' NOT NULL,
	"position" text NOT NULL,
	"contract_value" bigint,
	"start_date" date,
	"target_end_date" date,
	"finished_at" timestamp with time zone,
	"owner_id" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_deal_id_unique" UNIQUE("deal_id"),
	CONSTRAINT "project_contract_not_negative" CHECK ("project"."contract_value" is null or "project"."contract_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "strategy_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid,
	"project_id" uuid,
	"goal" text NOT NULL,
	"target_date" date,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"owner_id" text,
	"from_suggestion_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "txn_type" NOT NULL,
	"name" text NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "txn_type" NOT NULL,
	"status" "txn_status" DEFAULT 'paid' NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"category_id" uuid,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"description" text,
	"method" "payment_method",
	"reference" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_amount_positive" CHECK ("transaction"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_plan_id_strategy_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."strategy_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_plan" ADD CONSTRAINT "strategy_plan_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_plan" ADD CONSTRAINT "strategy_plan_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_plan" ADD CONSTRAINT "strategy_plan_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_plan" ADD CONSTRAINT "strategy_plan_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_open_assignee_due_idx" ON "action" USING btree ("assignee_id","due_at") WHERE "action"."done_at" is null;--> statement-breakpoint
CREATE INDEX "action_open_deal_due_idx" ON "action" USING btree ("deal_id","due_at") WHERE "action"."done_at" is null;--> statement-breakpoint
CREATE INDEX "action_open_project_due_idx" ON "action" USING btree ("project_id","due_at") WHERE "action"."done_at" is null;--> statement-breakpoint
CREATE INDEX "action_plan_sort_idx" ON "action" USING btree ("plan_id","sort");--> statement-breakpoint
CREATE INDEX "activity_client_occurred_idx" ON "activity" USING btree ("client_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "client_name_lower_idx" ON "client" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "client_status_idx" ON "client" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contact_client_idx" ON "contact" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_one_primary_idx" ON "contact" USING btree ("client_id") WHERE "contact"."is_primary";--> statement-breakpoint
CREATE INDEX "deal_stage_pos_idx" ON "deal" USING btree ("stage","position");--> statement-breakpoint
CREATE INDEX "deal_client_idx" ON "deal" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "project_stage_pos_idx" ON "project" USING btree ("stage","position");--> statement-breakpoint
CREATE INDEX "project_client_idx" ON "project" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "strategy_plan_status_target_idx" ON "strategy_plan" USING btree ("status","target_date");--> statement-breakpoint
CREATE INDEX "strategy_plan_client_idx" ON "strategy_plan" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_type_name_idx" ON "category" USING btree ("type","name");--> statement-breakpoint
CREATE INDEX "transaction_client_date_idx" ON "transaction" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "transaction_date_type_status_idx" ON "transaction" USING btree ("date","type","status");--> statement-breakpoint
CREATE INDEX "transaction_project_idx" ON "transaction" USING btree ("project_id");