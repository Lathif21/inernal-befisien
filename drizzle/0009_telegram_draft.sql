CREATE TABLE "telegram_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"answer" jsonb NOT NULL,
	"source" text NOT NULL,
	"input" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_draft_status" CHECK ("telegram_draft"."status" in ('pending', 'saved', 'cancelled', 'replaced'))
);
--> statement-breakpoint
ALTER TABLE "telegram_draft" ADD CONSTRAINT "telegram_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_draft_chat_idx" ON "telegram_draft" USING btree ("chat_id","created_at" DESC NULLS LAST);