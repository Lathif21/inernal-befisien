CREATE TABLE "email_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"email_id" uuid,
	"token" text,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_file_key_unique" UNIQUE("key"),
	CONSTRAINT "email_file_token_unique" UNIQUE("token"),
	CONSTRAINT "email_file_status" CHECK ("email_file"."status" in ('uploading', 'sent', 'deleted')),
	CONSTRAINT "email_file_size_positive" CHECK ("email_file"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "email_file" ADD CONSTRAINT "email_file_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_file" ADD CONSTRAINT "email_file_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_file_status_idx" ON "email_file" USING btree ("status","expires_at");