CREATE TABLE "email_draft" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" uuid,
	"forward_email_id" uuid,
	"forward_files" text[] DEFAULT '{}'::text[] NOT NULL,
	"to" text DEFAULT '' NOT NULL,
	"cc" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"run_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_draft_status" CHECK ("email_draft"."status" in ('draft', 'scheduled', 'sending', 'failed')),
	CONSTRAINT "email_draft_scheduled_at" CHECK ("email_draft"."status" not in ('scheduled', 'sending') or "email_draft"."scheduled_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "email_file" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "email_draft" ADD CONSTRAINT "email_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_draft" ADD CONSTRAINT "email_draft_thread_id_email_message_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_draft" ADD CONSTRAINT "email_draft_forward_email_id_email_message_id_fk" FOREIGN KEY ("forward_email_id") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_draft_user_idx" ON "email_draft" USING btree ("user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_draft_thread_idx" ON "email_draft" USING btree ("thread_id");--> statement-breakpoint
ALTER TABLE "email_file" ADD CONSTRAINT "email_file_draft_id_email_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."email_draft"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_message_deleted_idx" ON "email_message" USING btree ("deleted_at") WHERE "email_message"."deleted_at" is not null;