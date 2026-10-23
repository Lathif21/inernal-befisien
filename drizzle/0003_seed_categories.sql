-- Standard transaction categories (docs/02-DATA-MODEL.md "Seed categories"). Reference data every
-- environment needs, so it ships as a migration; scripts/seed.ts upserts the same list.
INSERT INTO "category" ("type", "name", "sort") VALUES
	('income', 'DP / Uang Muka', 0),
	('income', 'Termin', 1),
	('income', 'Pelunasan', 2),
	('income', 'Maintenance / Retainer', 3),
	('income', 'Lainnya', 4),
	('expense', 'Vendor / Subkontraktor', 0),
	('expense', 'Freelancer', 1),
	('expense', 'Lisensi & Software', 2),
	('expense', 'Server & Cloud', 3),
	('expense', 'Hardware', 4),
	('expense', 'Transport & Akomodasi', 5),
	('expense', 'Lainnya', 6)
ON CONFLICT ("type", "name") DO NOTHING;
