ALTER TABLE "transaction" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "is_overhead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_income_has_client" CHECK ("transaction"."type" <> 'income' or "transaction"."client_id" is not null);--> statement-breakpoint
-- Overhead expense categories (docs/02-DATA-MODEL.md "Seed categories"); scripts/seed.ts upserts the same list.
INSERT INTO "category" ("type", "name", "is_overhead", "sort") VALUES
	('expense', 'Gaji', true, 10),
	('expense', 'Sewa Kantor', true, 11),
	('expense', 'Internet & Utilitas', true, 12),
	('expense', 'Marketing', true, 13),
	('expense', 'Langganan Tools', true, 14),
	('expense', 'Pajak & Admin Bank', true, 15)
ON CONFLICT ("type", "name") DO UPDATE SET "is_overhead" = true;
