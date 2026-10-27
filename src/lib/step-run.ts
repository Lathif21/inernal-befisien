// Executable plan steps (P2-13). A step is a reminder, or a system action from a fixed list. The AI
// writes the action into a plan step (`action.payload`); Jalankan turns it into a run the user checks
// and corrects before Simpan (`services/step-runs.ts`). Pure, shared by the server (Telegram, form
// actions) and the web modal. Relative imports only: the Trigger.dev bundle uses it too.
import { z } from 'zod';
import {
	CLIENT_SOURCES,
	DEAL_STAGES,
	INDUSTRIES,
	OPEN_DEAL_STAGES,
	PAYMENT_METHODS,
	SERVICE_TYPES,
	type DealStage,
	type StepKind
} from './constants';
import { wibLocalToDate } from './format';

export type RunKind = Exclude<StepKind, 'reminder'>;

export const RUN_KIND_LABELS: Record<RunKind, string> = {
	update_client: 'Lengkapi profil klien',
	create_deal: 'Buat deal',
	move_deal: 'Pindahkan deal',
	record_payment: 'Catat pembayaran'
};

export const isRunKind = (kind: string | null | undefined): kind is RunKind =>
	!!kind && kind in RUN_KIND_LABELS;

/** What the plan knew about the action when the step was written; filled in at Jalankan */
export type StepPayload =
	| {
			kind: 'update_client';
			industry?: string;
			source?: string;
			city?: string;
			website?: string;
			notes?: string;
			/** A line for the Ringkasan konteks */
			context?: string;
	  }
	| { kind: 'create_deal'; title?: string; value?: number | null; serviceType?: string }
	| { kind: 'move_deal'; dealId: string; to: DealStage }
	| { kind: 'record_payment'; invoiceNumber: string; amount?: number | null };

// ---------- the AI's action text ----------

/** The action names the AI writes after the step title ("… | pindah_deal; deal=…; tahap=proposal") */
const ACTION_NAMES: Record<string, RunKind> = {
	profil: 'update_client',
	deal_baru: 'create_deal',
	pindah_deal: 'move_deal',
	bayar_invoice: 'record_payment'
};

export const STEP_ACTION_PATTERN = /^\s*(profil|deal_baru|pindah_deal|bayar_invoice)\b/i;

const amountOf = (v: string | undefined) => {
	const n = Number((v ?? '').replace(/\D/g, ''));
	return n > 0 ? n : null;
};
const oneOf = (v: string | undefined, list: readonly string[]) =>
	v && list.includes(v) ? v : undefined;
const textOf = (v: string | undefined, max: number) => v?.trim().slice(0, max) || undefined;

/** "pindah_deal; deal=<id>; tahap=proposal" → payload; null when it is not a usable action */
export function parseStepAction(text: string): StepPayload | null {
	const [head, ...parts] = text.split(';');
	const kind = ACTION_NAMES[head.trim().toLowerCase()];
	if (!kind) return null;
	const kv: Record<string, string> = {};
	for (const part of parts) {
		const i = part.indexOf('=');
		if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
	}
	switch (kind) {
		case 'update_client':
			return {
				kind,
				industry: oneOf(kv.industri, INDUSTRIES),
				source: oneOf(kv.sumber, CLIENT_SOURCES),
				city: textOf(kv.kota, 80),
				website: textOf(kv.website, 200),
				notes: textOf(kv.catatan, 1000),
				context: textOf(kv.konteks, 1000)
			};
		case 'create_deal':
			return {
				kind,
				title: textOf(kv.judul, 150),
				value: amountOf(kv.nilai),
				serviceType: oneOf(kv.layanan, SERVICE_TYPES)
			};
		case 'move_deal': {
			const to = oneOf(kv.tahap, OPEN_DEAL_STAGES) as DealStage | undefined;
			return kv.deal && to ? { kind, dealId: kv.deal, to } : null;
		}
		case 'record_payment':
			return kv.invoice ? { kind, invoiceNumber: kv.invoice, amount: amountOf(kv.jumlah) } : null;
	}
}

// ---------- the run (what Simpan writes) ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const wibDue = (message: string) =>
	z
		.string()
		.trim()
		.refine((v) => LOCAL.test(v) && wibLocalToDate(v) !== null, { message });
const choice = (values: readonly string[], message: string) =>
	z
		.string()
		.trim()
		.default('')
		.refine((v) => v === '' || values.includes(v), { message });
const rupiah = z
	.number({ message: 'Masukkan angka.' })
	.int('Tanpa desimal.')
	.min(0, 'Tidak boleh negatif.')
	.max(999_999_999_999, 'Nilai terlalu besar.');

/** The step after this one, when it is the card's last open step (every active card keeps one) */
export const runNextSchema = z
	.object({
		title: z
			.string()
			.trim()
			.min(3, 'Tulis langkah berikutnya (min. 3 karakter).')
			.max(200, 'Langkah berikutnya maksimal 200 karakter.'),
		due: wibDue('Pilih tanggal dan jam langkah berikutnya.')
	})
	.nullable()
	.default(null);

const profileFields = {
	industry: choice(INDUSTRIES, 'Pilih industri dari daftar.'),
	source: choice(CLIENT_SOURCES, 'Pilih sumber dari daftar.'),
	city: z.string().trim().max(80, 'Kota maksimal 80 karakter.').default(''),
	website: z.string().trim().max(200, 'Website maksimal 200 karakter.').default(''),
	notes: z.string().trim().max(5000, 'Catatan maksimal 5000 karakter.').default('')
};

export const runSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('update_client'),
		...profileFields,
		/** Added to the end of the Ringkasan konteks */
		contextAdd: z.string().trim().max(2000, 'Tambahan konteks maksimal 2000 karakter.').default(''),
		/** The profile when Jalankan was tapped: only fields that differ from it are written */
		base: z.object(profileFields),
		next: runNextSchema
	}),
	z.object({
		kind: z.literal('create_deal'),
		title: z
			.string()
			.trim()
			.min(3, 'Judul deal minimal 3 karakter.')
			.max(150, 'Judul deal maksimal 150 karakter.'),
		valueEstimate: rupiah.nullable().default(null),
		serviceType: choice(SERVICE_TYPES, 'Pilih layanan dari daftar.'),
		firstStepTitle: z
			.string()
			.trim()
			.min(3, 'Tulis langkah pertama deal (min. 3 karakter).')
			.max(200, 'Langkah pertama maksimal 200 karakter.'),
		firstStepDue: wibDue('Pilih tanggal dan jam langkah pertama.'),
		next: runNextSchema
	}),
	z.object({
		kind: z.literal('move_deal'),
		dealId: z.uuid({ message: 'Deal tidak valid.' }),
		to: z.enum(OPEN_DEAL_STAGES, { message: 'Pilih tahap tujuan.' }),
		next: runNextSchema
	}),
	z.object({
		kind: z.literal('record_payment'),
		invoiceId: z.uuid({ message: 'Invoice tidak valid.' }),
		amount: rupiah.min(1, 'Jumlah harus lebih dari 0.'),
		date: z.string().regex(DAY, 'Pilih tanggal pembayaran.'),
		method: z.enum(PAYMENT_METHODS, { message: 'Pilih metode dari daftar.' }).default('transfer'),
		next: runNextSchema
	})
]);

export type RunDraft = z.infer<typeof runSchema>;
export type RunNext = z.infer<typeof runNextSchema>;

/** Everything the preview shows next to the run (names, the state before) */
export type RunView = {
	stepId: string;
	stepTitle: string;
	clientId: string;
	clientName: string;
	cardTitle: string;
	/** The card's last open step: Simpan also adds `next` */
	needsNext: boolean;
	/** update_client: the current Ringkasan konteks */
	context?: string | null;
	/** move_deal */
	dealTitle?: string;
	dealStage?: DealStage;
	/** record_payment */
	invoiceNumber?: string;
	remaining?: number;
	categoryName?: string;
};

/** Stages a deal can move to from `from` by Jalankan: later open stages only */
export function laterOpenStages(from: DealStage) {
	const i = DEAL_STAGES.indexOf(from);
	return OPEN_DEAL_STAGES.filter((s) => DEAL_STAGES.indexOf(s) > i);
}

/** First problem of a run, for one-line messages (Telegram) */
export function runProblem(input: unknown): string | null {
	const r = runSchema.safeParse(input);
	return r.success ? null : (r.error.issues[0]?.message ?? 'Data belum lengkap.');
}
