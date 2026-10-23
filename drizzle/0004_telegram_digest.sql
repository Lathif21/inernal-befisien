ALTER TABLE "user" ADD COLUMN "digest_channels" text[] DEFAULT '{telegram,email}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "telegram_link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_telegram_link_code_unique" UNIQUE("telegram_link_code");