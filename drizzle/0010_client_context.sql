CREATE TABLE "client_context" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"input_hash" text,
	"model" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_context" ADD CONSTRAINT "client_context_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_context" ADD CONSTRAINT "client_context_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;