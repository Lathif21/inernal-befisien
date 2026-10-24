// Company profile: example values until saved, then one row that later saves update.
// Runs in a rolled-back transaction on the Neon `dev` branch or localhost only.
import { describe, expect, it } from 'vitest';
import { createDb, type Tx } from '../db/client';
import { companyProfile, user } from '../db/schema/index';
import { companySchema } from '../../schemas/settings';
import { EXAMPLE_COMPANY, getCompanyProfile, saveCompanyProfile } from './company';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const url = process.env.DATABASE_URL;
const isDevDb =
	!!url &&
	(process.env.NEON_BRANCH === 'dev' || ['localhost', '127.0.0.1'].includes(new URL(url).hostname));

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx, userId: string) => Promise<void>) {
	const db = createDb(url!);
	try {
		await db.transaction(async (tx) => {
			const [u] = await tx.select({ id: user.id }).from(user).limit(1);
			if (!u) throw new Error('needs at least one user (npm run user:create)');
			await fn(tx, u.id);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	} finally {
		await db.$client.end();
	}
}

describe.skipIf(!isDevDb)('company profile', () => {
	it('shows examples until saved, then stores normalised values', { timeout: 30_000 }, () =>
		inRollback(async (tx, userId) => {
			await tx.delete(companyProfile);
			expect(await getCompanyProfile(tx)).toEqual({ ...EXAMPLE_COMPANY, isExample: true });

			const form = companySchema.parse({
				name: 'Befisien',
				address: 'Jl. Contoh 1\nSurabaya',
				city: 'Surabaya',
				phone: '0822-3456-7461',
				email: 'INFO@befisien.com',
				npwp: '01.234.567.8-901.000',
				bankName: 'BCA',
				bankAccountNumber: '123 456 7890',
				bankAccountName: 'PT Befisien',
				signerName: 'Gusti Rafi A',
				signerTitle: 'Direktur'
			});
			await saveCompanyProfile(tx, form, userId);
			const saved = await getCompanyProfile(tx);
			expect(saved).toMatchObject({
				isExample: false,
				phone: '6282234567461',
				email: 'info@befisien.com',
				npwp: '012345678901000',
				bankName: 'BCA'
			});

			await saveCompanyProfile(tx, { ...form, npwp: '', email: '', signerTitle: '' }, userId);
			expect(await getCompanyProfile(tx)).toMatchObject({
				npwp: null,
				email: null,
				signerTitle: ''
			});
			expect(await tx.$count(companyProfile)).toBe(1);
		})
	);
});
