// Strategy plan form (create / edit drawer on Strategi).
import { z } from 'zod';

export const planSchema = z
	.object({
		/** '' = create */
		id: z
			.string()
			.default('')
			.refine((v) => v === '' || z.uuid().safeParse(v).success, {
				message: 'Rencana tidak valid.'
			}),
		/** "deal:<uuid>" or "project:<uuid>": the card the plan's steps belong to (create only) */
		card: z.string().default(''),
		goal: z
			.string()
			.trim()
			.min(5, 'Tulis tujuan rencana (min. 5 karakter).')
			.max(200, 'Tujuan maksimal 200 karakter.'),
		targetDate: z
			.string()
			.default('')
			.refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), {
				message: 'Tanggal tidak valid.'
			}),
		notes: z.string().trim().max(2000, 'Catatan maksimal 2000 karakter.').default('')
	})
	.superRefine((p, ctx) => {
		if (p.id === '' && !parseCard(p.card)) {
			ctx.addIssue({ code: 'custom', path: ['card'], message: 'Pilih deal atau proyek.' });
		}
	});

export type PlanInput = z.infer<typeof planSchema>;

/** "deal:<uuid>" → { dealId } / "project:<uuid>" → { projectId } */
export function parseCard(value: string): { dealId: string } | { projectId: string } | null {
	const [kind, id] = value.split(':');
	if (!z.uuid().safeParse(id).success) return null;
	if (kind === 'deal') return { dealId: id };
	if (kind === 'project') return { projectId: id };
	return null;
}
