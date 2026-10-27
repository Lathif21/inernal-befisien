CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"resend_id" text NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"thread_id" uuid NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"to" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_to" text,
	"subject" text DEFAULT '' NOT NULL,
	"text" text,
	"html" text,
	"snippet" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bulk" boolean DEFAULT false NOT NULL,
	"client_id" uuid,
	"contact_id" uuid,
	"user_id" text,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_message_resend_id_unique" UNIQUE("resend_id"),
	CONSTRAINT "email_message_direction" CHECK ("email_message"."direction" in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_message_thread_idx" ON "email_message" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "email_message_sent_idx" ON "email_message" USING btree ("sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_message_message_id_idx" ON "email_message" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_message_client_idx" ON "email_message" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "email_message_unread_idx" ON "email_message" USING btree ("thread_id") WHERE "email_message"."direction" = 'in' and "email_message"."read_at" is null;--> statement-breakpoint
CREATE INDEX "contact_email_lower_idx" ON "contact" USING btree (lower("email"));