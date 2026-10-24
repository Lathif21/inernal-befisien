// Company profile printed on invoices (Settings → Profil perusahaan, task P2-06). Relative imports only.
import { eq } from 'drizzle-orm';
import { phoneNormalize } from '../../format';
import type { CompanyInput } from '../../schemas/settings';
import type { DbOrTx } from '../db/client';
import { companyProfile } from '../db/schema/index';

export type CompanyProfile = {
	name: string;
	address: string;
	city: string;
	phone: string | null;
	email: string | null;
	npwp: string | null;
	bankName: string;
	bankAccountNumber: string;
	bankAccountName: string;
	signerName: string;
	signerTitle: string;
	/** true until someone saves the profile: the values below are examples */
	isExample: boolean;
};

/** Shown (and printed) until the profile is saved once. Bank and NPWP are placeholders. */
export const EXAMPLE_COMPANY: Omit<CompanyProfile, 'isExample'> = {
	name: 'Befisien',
	address: 'Surabaya, Indonesia',
	city: 'Surabaya',
	phone: '6282234567461',
	email: 'info@befisien.com',
	npwp: '012345678901000',
	bankName: 'Bank Contoh',
	bankAccountNumber: '000 000 0000',
	bankAccountName: 'Befisien',
	signerName: 'Gusti Rafi A',
	signerTitle: 'Direktur'
};

export async function getCompanyProfile(db: DbOrTx): Promise<CompanyProfile> {
	const [row] = await db.select().from(companyProfile).where(eq(companyProfile.id, 1));
	if (!row) return { ...EXAMPLE_COMPANY, isExample: true };
	return {
		name: row.name,
		address: row.address,
		city: row.city,
		phone: row.phone,
		email: row.email,
		npwp: row.npwp,
		bankName: row.bankName,
		bankAccountNumber: row.bankAccountNumber,
		bankAccountName: row.bankAccountName,
		signerName: row.signerName,
		signerTitle: row.signerTitle,
		isExample: false
	};
}

export async function saveCompanyProfile(db: DbOrTx, input: CompanyInput, userId: string) {
	const values = {
		name: input.name,
		address: input.address,
		city: input.city,
		phone: phoneNormalize(input.phone),
		email: input.email || null,
		npwp: input.npwp.replace(/\D/g, '') || null,
		bankName: input.bankName,
		bankAccountNumber: input.bankAccountNumber,
		bankAccountName: input.bankAccountName,
		signerName: input.signerName,
		signerTitle: input.signerTitle,
		updatedAt: new Date(),
		updatedBy: userId
	};
	await db
		.insert(companyProfile)
		.values({ id: 1, ...values })
		.onConflictDoUpdate({ target: companyProfile.id, set: values });
}
