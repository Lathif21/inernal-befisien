ALTER TABLE "action" ADD COLUMN "kind" text DEFAULT 'reminder' NOT NULL;--> statement-breakpoint
ALTER TABLE "action" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_kind" CHECK ("action"."kind" in ('reminder', 'update_client', 'create_deal', 'move_deal', 'record_payment'));