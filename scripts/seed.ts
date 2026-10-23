// Seeds categories and a realistic demo dataset. DEV ONLY: refuses to run against production.
// npm run db:seed            (empty CRM tables only)
// npm run db:seed -- --reset (wipes CRM + finance tables first; users are kept)
import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';
import { sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { parseArgs } from 'node:util';
import { DEAL_STAGE_META } from '../src/lib/constants.ts';
import { TZ } from '../src/lib/format.ts';
import { createDb, type Tx } from '../src/lib/server/db/client.ts';
import { logActivity } from '../src/lib/server/services/activity.ts';
import {
	action,
	activity,
	category,
	client,
	contact,
	deal,
	project,
	strategyPlan,
	transaction,
	user
} from '../src/lib/server/db/schema/index.ts';

try {
	process.loadEnvFile();
} catch {
	// no .env: use the real environment
}

const { values: args } = parseArgs({ options: { reset: { type: 'boolean', default: false } } });

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set');
const host = new URL(url).hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1';
if (!isLocal && process.env.NEON_BRANCH !== 'dev') {
	fail(
		`refusing to seed ${host} (NEON_BRANCH=${process.env.NEON_BRANCH ?? 'unset'}). ` +
			'Demo data only goes to the Neon dev branch (`neon checkout dev`) or a local database.'
	);
}

const db = createDb(url);

// ---------- time helpers (all WIB) ----------
const today = new TZDate(Date.now(), TZ);
/** Instant at `days` from today, at HH:mm WIB */
const at = (days: number, hhmm: string) => {
	const d = addDays(today, days);
	const [h, m] = hhmm.split(':').map(Number);
	return new Date(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), h, m, TZ).getTime());
};
/** Postgres `date` string for `days` from today (WIB calendar) */
const day = (days: number) => format(addDays(today, days), 'yyyy-MM-dd');

// ---------- demo data ----------
const CATEGORIES = {
	income: ['DP / Uang Muka', 'Termin', 'Pelunasan', 'Maintenance / Retainer', 'Lainnya'],
	expense: [
		'Vendor / Subkontraktor',
		'Freelancer',
		'Lisensi & Software',
		'Server & Cloud',
		'Hardware',
		'Transport & Akomodasi',
		'Lainnya'
	]
} as const;

type ClientSeed = typeof client.$inferInsert & {
	key: string;
	contacts: { name: string; position: string; phone: string; email: string }[];
};

const CLIENTS: ClientSeed[] = [
	{
		key: 'surya',
		name: 'PT Surya Daya Mandiri',
		industry: 'energy',
		source: 'referral',
		city: 'Surabaya',
		website: 'https://suryadaya.example',
		contacts: [
			{
				name: 'Budi Santoso',
				position: 'Direktur Operasional',
				phone: '6281234500001',
				email: 'budi@suryadaya.example'
			},
			{
				name: 'Rina Kartika',
				position: 'Manajer IT',
				phone: '6281234500002',
				email: 'rina@suryadaya.example'
			}
		]
	},
	{
		key: 'nusantara',
		name: 'PT Nusantara Logistik Prima',
		industry: 'logistics',
		source: 'apollo',
		city: 'Jakarta Utara',
		contacts: [
			{
				name: 'Andi Wijaya',
				position: 'Head of Supply Chain',
				phone: '6281234500003',
				email: 'andi@nlp.example'
			}
		]
	},
	{
		key: 'garuda',
		name: 'CV Garuda Manufaktur',
		industry: 'manufacturing',
		source: 'existing_network',
		city: 'Bekasi',
		contacts: [
			{
				name: 'Siti Rahmawati',
				position: 'Pemilik',
				phone: '6281234500004',
				email: 'siti@garuda.example'
			}
		]
	},
	{
		key: 'bina',
		name: 'Yayasan Bina Cendekia',
		industry: 'education',
		source: 'website',
		city: 'Bandung',
		contacts: [
			{
				name: 'Dewi Lestari',
				position: 'Kepala Sekolah',
				phone: '6281234500005',
				email: 'dewi@binacendekia.example'
			}
		]
	},
	{
		key: 'artha',
		name: 'PT Artha Finansial Sejahtera',
		industry: 'finance',
		source: 'event',
		city: 'Jakarta Selatan',
		contacts: [
			{
				name: 'Hendra Gunawan',
				position: 'VP Digital',
				phone: '6281234500006',
				email: 'hendra@artha.example'
			},
			{
				name: 'Maya Putri',
				position: 'Procurement',
				phone: '6281234500007',
				email: 'maya@artha.example'
			}
		]
	},
	{
		key: 'mitra',
		name: 'PT Mitra Energi Terbarukan',
		industry: 'energy',
		source: 'website',
		city: 'Semarang',
		contacts: [
			{
				name: 'Agus Pratama',
				position: 'Direktur Utama',
				phone: '6281234500008',
				email: 'agus@mitraenergi.example'
			}
		]
	},
	{
		key: 'sinar',
		name: 'PT Sinar Pangan Indonesia',
		industry: 'manufacturing',
		source: 'referral',
		city: 'Tangerang',
		contacts: [
			{
				name: 'Lukman Hakim',
				position: 'Plant Manager',
				phone: '6281234500009',
				email: 'lukman@sinarpangan.example'
			}
		]
	},
	{
		key: 'kopi',
		name: 'Kopi Kenangan Senja',
		industry: 'other',
		source: 'other',
		city: 'Yogyakarta',
		status: 'inactive',
		contacts: [
			{
				name: 'Fajar Nugroho',
				position: 'Owner',
				phone: '6281234500010',
				email: 'fajar@kopisenja.example'
			}
		]
	}
];

type DealSeed = Omit<typeof deal.$inferInsert, 'clientId' | 'position'> & {
	key: string;
	client: string;
	/** days ago the deal entered its current stage */
	inStageDays: number;
};

const DEALS: DealSeed[] = [
	{
		key: 'd1',
		client: 'mitra',
		title: 'AI untuk monitoring PLTS',
		serviceType: 'energy_ai',
		stage: 'lead',
		valueEstimate: 120_000_000,
		inStageDays: 2
	},
	{
		key: 'd2',
		client: 'sinar',
		title: 'Dashboard produksi harian',
		serviceType: 'dashboard_app',
		stage: 'lead',
		valueEstimate: 45_000_000,
		inStageDays: 5
	},
	{
		key: 'd3',
		client: 'bina',
		title: 'Website & CMS sekolah',
		serviceType: 'web_cms',
		stage: 'contacted',
		valueEstimate: 28_000_000,
		inStageDays: 4
	},
	{
		key: 'd4',
		client: 'nusantara',
		title: 'Integrasi WMS dengan ERP',
		serviceType: 'integration',
		stage: 'contacted',
		valueEstimate: 95_000_000,
		inStageDays: 9
	},
	{
		key: 'd5',
		client: 'artha',
		title: 'AI Agent layanan nasabah',
		serviceType: 'ai_agent',
		stage: 'meeting',
		valueEstimate: 180_000_000,
		probability: 40,
		inStageDays: 6
	},
	{
		key: 'd6',
		client: 'garuda',
		title: 'Otomasi purchase order',
		serviceType: 'automation',
		stage: 'meeting',
		valueEstimate: 38_000_000,
		inStageDays: 12
	},
	{
		key: 'd7',
		client: 'surya',
		title: 'AI Agent pengadaan barang',
		serviceType: 'ai_agent',
		stage: 'proposal',
		valueEstimate: 150_000_000,
		probability: 60,
		expectedClose: day(25),
		inStageDays: 8
	},
	{
		key: 'd8',
		client: 'nusantara',
		title: 'Otomasi laporan pengiriman',
		serviceType: 'automation',
		stage: 'proposal',
		valueEstimate: 52_000_000,
		probability: 50,
		inStageDays: 3
	},
	{
		key: 'd9',
		client: 'artha',
		title: 'Dashboard risiko kredit',
		serviceType: 'dashboard_app',
		stage: 'negotiation',
		valueEstimate: 210_000_000,
		probability: 75,
		expectedClose: day(14),
		inStageDays: 5
	},
	{
		key: 'd10',
		client: 'surya',
		title: 'Integrasi SCADA ke dashboard',
		serviceType: 'integration',
		stage: 'won',
		valueEstimate: 135_000_000,
		probability: 100,
		inStageDays: 18
	},
	{
		key: 'd11',
		client: 'garuda',
		title: 'Website katalog produk',
		serviceType: 'web_cms',
		stage: 'won',
		valueEstimate: 32_000_000,
		probability: 100,
		inStageDays: 6
	},
	{
		key: 'd12',
		client: 'kopi',
		title: 'Aplikasi loyalitas pelanggan',
		serviceType: 'dashboard_app',
		stage: 'lost',
		valueEstimate: 25_000_000,
		lostReason: 'Anggaran ditunda ke tahun depan',
		inStageDays: 20
	}
];

type ProjectSeed = Omit<typeof project.$inferInsert, 'clientId' | 'position' | 'dealId'> & {
	key: string;
	client: string;
	deal?: string;
	inStageDays: number;
};

const PROJECTS: ProjectSeed[] = [
	{
		key: 'p1',
		client: 'surya',
		deal: 'd10',
		name: 'Integrasi SCADA ke dashboard',
		serviceType: 'integration',
		stage: 'in_progress',
		contractValue: 135_000_000,
		startDate: day(-16),
		targetEndDate: day(45),
		inStageDays: 12
	},
	{
		key: 'p2',
		client: 'garuda',
		deal: 'd11',
		name: 'Website katalog produk',
		serviceType: 'web_cms',
		stage: 'onboarding',
		contractValue: 32_000_000,
		startDate: day(-4),
		targetEndDate: day(30),
		inStageDays: 4
	},
	{
		key: 'p3',
		client: 'nusantara',
		name: 'Chatbot pelacakan paket',
		serviceType: 'ai_agent',
		stage: 'review',
		contractValue: 88_000_000,
		startDate: day(-110),
		targetEndDate: day(7),
		inStageDays: 9
	},
	{
		key: 'p4',
		client: 'bina',
		name: 'Sistem informasi akademik',
		serviceType: 'dashboard_app',
		stage: 'maintenance',
		contractValue: 60_000_000,
		startDate: day(-300),
		targetEndDate: day(-120),
		finishedAt: at(-120, '16:00'),
		inStageDays: 120
	}
];

// [project, type, status, daysFromToday, amount, category, description, method]
type TxnSeed = [
	string,
	'income' | 'expense',
	'paid' | 'planned',
	number,
	number,
	string,
	string,
	('transfer' | 'cash' | 'card' | 'ewallet')?
];

const TRANSACTIONS: TxnSeed[] = [
	// p1 Surya — SCADA (135 jt)
	['p1', 'income', 'paid', -15, 40_500_000, 'DP / Uang Muka', 'DP 30% integrasi SCADA', 'transfer'],
	['p1', 'expense', 'paid', -12, 6_500_000, 'Hardware', 'Gateway Modbus 2 unit', 'transfer'],
	[
		'p1',
		'expense',
		'paid',
		-10,
		4_200_000,
		'Freelancer',
		'Freelancer frontend minggu 1–2',
		'transfer'
	],
	['p1', 'expense', 'paid', -3, 1_350_000, 'Server & Cloud', 'VPS & database bulan ini', 'card'],
	['p1', 'income', 'planned', 20, 54_000_000, 'Termin', 'Termin 2 (40%) setelah UAT', 'transfer'],
	['p1', 'income', 'planned', 50, 40_500_000, 'Pelunasan', 'Pelunasan 30%', 'transfer'],
	// p2 Garuda — website (32 jt)
	['p2', 'income', 'paid', -4, 16_000_000, 'DP / Uang Muka', 'DP 50% website katalog', 'transfer'],
	['p2', 'expense', 'paid', -2, 1_800_000, 'Lisensi & Software', 'Tema & plugin premium', 'card'],
	['p2', 'income', 'planned', 30, 16_000_000, 'Pelunasan', 'Pelunasan setelah go-live', 'transfer'],
	// p3 Nusantara — chatbot (88 jt)
	['p3', 'income', 'paid', -105, 26_400_000, 'DP / Uang Muka', 'DP 30% chatbot', 'transfer'],
	[
		'p3',
		'expense',
		'paid',
		-98,
		7_500_000,
		'Vendor / Subkontraktor',
		'Integrasi API kurir (vendor)',
		'transfer'
	],
	[
		'p3',
		'expense',
		'paid',
		-90,
		2_400_000,
		'Lisensi & Software',
		'Langganan LLM API 3 bulan',
		'card'
	],
	['p3', 'income', 'paid', -60, 35_200_000, 'Termin', 'Termin 2 (40%)', 'transfer'],
	['p3', 'expense', 'paid', -55, 9_000_000, 'Freelancer', 'Freelancer QA', 'transfer'],
	[
		'p3',
		'expense',
		'paid',
		-40,
		1_200_000,
		'Transport & Akomodasi',
		'Kunjungan ke gudang Cikarang',
		'cash'
	],
	[
		'p3',
		'expense',
		'paid',
		-20,
		2_400_000,
		'Lisensi & Software',
		'Langganan LLM API 3 bulan',
		'card'
	],
	[
		'p3',
		'income',
		'planned',
		10,
		26_400_000,
		'Pelunasan',
		'Pelunasan 30% setelah review',
		'transfer'
	],
	// p4 Bina — SIAKAD (60 jt) + retainer
	['p4', 'income', 'paid', -298, 30_000_000, 'DP / Uang Muka', 'DP 50% SIAKAD', 'transfer'],
	['p4', 'expense', 'paid', -280, 8_000_000, 'Freelancer', 'Freelancer backend', 'transfer'],
	['p4', 'expense', 'paid', -200, 3_600_000, 'Server & Cloud', 'Server 12 bulan', 'transfer'],
	['p4', 'income', 'paid', -120, 30_000_000, 'Pelunasan', 'Pelunasan SIAKAD', 'transfer'],
	[
		'p4',
		'income',
		'paid',
		-90,
		2_500_000,
		'Maintenance / Retainer',
		'Retainer bulan 1',
		'transfer'
	],
	[
		'p4',
		'income',
		'paid',
		-60,
		2_500_000,
		'Maintenance / Retainer',
		'Retainer bulan 2',
		'transfer'
	],
	[
		'p4',
		'income',
		'paid',
		-30,
		2_500_000,
		'Maintenance / Retainer',
		'Retainer bulan 3',
		'transfer'
	],
	['p4', 'expense', 'paid', -28, 450_000, 'Server & Cloud', 'Backup storage', 'card'],
	['p4', 'income', 'paid', -1, 2_500_000, 'Maintenance / Retainer', 'Retainer bulan 4', 'transfer'],
	[
		'p4',
		'income',
		'planned',
		29,
		2_500_000,
		'Maintenance / Retainer',
		'Retainer bulan 5',
		'transfer'
	],
	// presales costs on open deals (client only)
	[
		'surya',
		'expense',
		'paid',
		-9,
		850_000,
		'Transport & Akomodasi',
		'Presentasi proposal di Surabaya',
		'cash'
	],
	['artha', 'expense', 'paid', -6, 1_100_000, 'Lisensi & Software', 'Lisensi demo POC', 'card'],
	['artha', 'expense', 'paid', -2, 650_000, 'Transport & Akomodasi', 'Meeting negosiasi', 'ewallet']
];

// [card, title, days, time, done?]
type StepSeed = [string, string, number, string, boolean?];

const STEPS: StepSeed[] = [
	['d1', 'Kirim profil perusahaan via WA', 1, '10:00'],
	['d2', 'Telepon Pak Lukman untuk kualifikasi', -1, '14:00'],
	['d3', 'Jadwalkan demo CMS', 0, '15:30'],
	['d4', 'Follow up kebutuhan integrasi', 3, '09:00'],
	['d5', 'Siapkan demo AI agent', -3, '13:00', true],
	['d5', 'Demo AI agent ke tim digital', 2, '10:00'],
	['d6', 'Kirim ringkasan meeting', -2, '11:00'],
	['d8', 'Follow up proposal via WA', 0, '09:30'],
	['p2', 'Kickoff meeting dengan Bu Siti', 1, '13:00'],
	['p3', 'Kumpulkan feedback review', -1, '16:00'],
	['p4', 'Cek backup bulanan', 6, '09:00']
];

// Plans with steps: [goal, card, targetDays, steps]
const PLANS: [string, string, number, StepSeed[]][] = [
	[
		'Closing AI Agent pengadaan sebelum akhir bulan',
		'd7',
		25,
		[
			['d7', 'Kirim proposal final', -8, '10:00', true],
			['d7', 'Follow up proposal via WA', -2, '10:00'],
			['d7', 'Presentasi ulang ke direksi', 4, '14:00'],
			['d7', 'Negosiasi harga & termin', 10, '10:00'],
			['d7', 'Tanda tangan kontrak', 20, '15:00']
		]
	],
	[
		'Go-live dashboard SCADA tepat waktu',
		'p1',
		45,
		[
			['p1', 'Mapping tag SCADA', -10, '09:00', true],
			['p1', 'Build dashboard v1', -2, '17:00', true],
			['p1', 'UAT dengan tim operasional', 0, '13:00'],
			['p1', 'Training operator', 14, '10:00']
		]
	]
];

// ---------- run ----------
const [owner] = await db.select({ id: user.id, name: user.name }).from(user).limit(1);
if (!owner) fail('no users yet: run `npm run user:create` first');

const [{ n: existing }] = await db.select({ n: sql<number>`count(*)::int` }).from(client);
if (existing > 0 && !args.reset)
	fail(`${existing} clients already exist; rerun with --reset to wipe and reseed`);

await db.transaction(async (tx) => {
	if (args.reset) {
		await tx.execute(
			sql`truncate ${transaction}, ${category}, ${activity}, ${action}, ${strategyPlan}, ${project}, ${deal}, ${contact}, ${client} cascade`
		);
	}

	// Categories
	const cats = new Map<string, string>();
	for (const type of ['income', 'expense'] as const) {
		const rows = await tx
			.insert(category)
			.values(CATEGORIES[type].map((name, i) => ({ type, name, sort: i })))
			.returning();
		for (const r of rows) cats.set(`${type}:${r.name}`, r.id);
	}

	// Clients + contacts
	const clientIds = new Map<string, string>();
	const projectClients = new Set(PROJECTS.map((p) => p.client));
	for (const { key, contacts, ...c } of CLIENTS) {
		const status = c.status ?? (projectClients.has(key) ? 'active' : 'prospect');
		const [row] = await tx
			.insert(client)
			.values({ ...c, status, ownerId: owner.id })
			.returning({ id: client.id });
		clientIds.set(key, row.id);
		await tx
			.insert(contact)
			.values(contacts.map((ct, i) => ({ ...ct, clientId: row.id, isPrimary: i === 0 })));
		await log(tx, row.id, 'system', 'Klien ditambahkan (data demo)', {}, -60);
	}

	// Deals, positioned per stage column
	const dealIds = new Map<string, string>();
	const byStage = Map.groupBy(DEALS, (d) => d.stage ?? 'lead');
	for (const [, deals] of byStage) {
		const keys = generateNKeysBetween(null, null, deals.length);
		for (const [i, { key, client: ck, inStageDays, ...d }] of deals.entries()) {
			const changed = at(-inStageDays, '10:00');
			const [row] = await tx
				.insert(deal)
				.values({
					...d,
					clientId: clientIds.get(ck)!,
					position: keys[i],
					ownerId: owner.id,
					stageChangedAt: changed,
					wonAt: d.stage === 'won' ? changed : null,
					lostAt: d.stage === 'lost' ? changed : null
				})
				.returning({ id: deal.id });
			dealIds.set(key, row.id);
			if (d.stage !== 'lead') {
				await log(
					tx,
					clientIds.get(ck)!,
					'stage_change',
					`Deal "${d.title}" pindah ke tahap ${DEAL_STAGE_META[d.stage ?? 'lead'].label}`,
					{ dealId: row.id, to: d.stage },
					-inStageDays
				);
			}
		}
	}

	// Projects
	const projectIds = new Map<string, string>();
	const projByStage = Map.groupBy(PROJECTS, (p) => p.stage ?? 'onboarding');
	for (const [, projects] of projByStage) {
		const keys = generateNKeysBetween(null, null, projects.length);
		for (const [i, { key, client: ck, deal: dk, inStageDays, ...p }] of projects.entries()) {
			const [row] = await tx
				.insert(project)
				.values({
					...p,
					clientId: clientIds.get(ck)!,
					dealId: dk ? dealIds.get(dk)! : null,
					position: keys[i],
					ownerId: owner.id,
					stageChangedAt: at(-inStageDays, '10:00')
				})
				.returning({ id: project.id });
			projectIds.set(key, row.id);
		}
	}

	const card = (key: string) =>
		key.startsWith('d') ? { dealId: dealIds.get(key)! } : { projectId: projectIds.get(key)! };
	const clientOfCard = (key: string) =>
		clientIds.get(
			(DEALS.find((d) => d.key === key) ?? PROJECTS.find((p) => p.key === key))!.client
		)!;

	// Quick steps (no plan)
	for (const [ck, title, days, time, done] of STEPS) {
		await tx.insert(action).values({
			...card(ck),
			title,
			dueAt: at(days, time),
			assigneeId: owner.id,
			doneAt: done ? at(days, time) : null,
			doneBy: done ? owner.id : null
		});
	}

	// Strategy plans with ordered steps
	for (const [goal, ck, targetDays, steps] of PLANS) {
		const [plan] = await tx
			.insert(strategyPlan)
			.values({
				clientId: clientOfCard(ck),
				...card(ck),
				goal,
				targetDate: day(targetDays),
				ownerId: owner.id
			})
			.returning({ id: strategyPlan.id });
		await tx.insert(action).values(
			steps.map(([, title, days, time, done], i) => ({
				...card(ck),
				planId: plan.id,
				title,
				sort: i,
				dueAt: at(days, time),
				assigneeId: owner.id,
				doneAt: done ? at(days, time) : null,
				doneBy: done ? owner.id : null
			}))
		);
	}

	// Transactions
	for (const [ref, type, status, days, amount, cat, description, method] of TRANSACTIONS) {
		const isProject = ref.startsWith('p') && projectIds.has(ref);
		const clientId = isProject ? clientOfCard(ref) : clientIds.get(ref)!;
		await tx.insert(transaction).values({
			type,
			status,
			date: day(days),
			amount,
			categoryId: cats.get(`${type}:${cat}`)!,
			clientId,
			projectId: isProject ? projectIds.get(ref)! : null,
			description,
			method,
			createdBy: owner.id
		});
	}

	// A few notes on the timeline
	await log(
		tx,
		clientIds.get('surya')!,
		'meeting',
		'Meeting dengan Pak Budi: tertarik perluasan AI ke gudang kedua.',
		{},
		-9
	);
	await log(
		tx,
		clientIds.get('artha')!,
		'call',
		'Telepon Bu Maya: procurement minta termin 3x.',
		{},
		-2
	);
	await log(
		tx,
		clientIds.get('nusantara')!,
		'whatsapp',
		'Pak Andi kirim daftar SKU untuk integrasi.',
		{},
		-1
	);
});

const counts = await db.execute<{ t: string; n: number }>(sql`
	select 'client' t, count(*)::int n from ${client} union all
	select 'contact', count(*)::int from ${contact} union all
	select 'deal', count(*)::int from ${deal} union all
	select 'project', count(*)::int from ${project} union all
	select 'strategy_plan', count(*)::int from ${strategyPlan} union all
	select 'action', count(*)::int from ${action} union all
	select 'activity', count(*)::int from ${activity} union all
	select 'category', count(*)::int from ${category} union all
	select 'transaction', count(*)::int from ${transaction}`);
console.log(
	`Seeded ${host} (${isLocal ? 'local' : `neon branch ${process.env.NEON_BRANCH}`}), owner ${owner.name}:`
);
for (const r of counts.rows) console.log(`  ${r.t.padEnd(14)} ${r.n}`);
process.exit(0);

async function log(
	tx: Tx,
	clientId: string,
	type: typeof activity.$inferInsert.type,
	body: string,
	meta: Record<string, unknown>,
	days: number
) {
	const { dealId, ...rest } = meta as { dealId?: string };
	await logActivity(tx, {
		clientId,
		dealId,
		type,
		body,
		meta: rest,
		userId: type === 'system' ? null : owner.id,
		occurredAt: at(days, '09:00')
	});
}

function fail(message: string): never {
	console.error(`Error: ${message}`);
	process.exit(1);
}
