CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"ai_frequency" text DEFAULT 'daily' NOT NULL,
	"ai_time" text DEFAULT '06:30' NOT NULL,
	"ai_weekday" smallint DEFAULT 1 NOT NULL,
	"ai_month_day" smallint DEFAULT 1 NOT NULL,
	"ai_last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "app_settings_single_row" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "app_settings_ai_frequency" CHECK ("app_settings"."ai_frequency" in ('daily', 'weekly', 'monthly', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;