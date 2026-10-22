// Creates a login for the CRM (public sign-up is disabled).
// npm run user:create -- --email a@befisien.com --name "Nama" [--password …] [--role admin]
import { randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client.ts';
import { account, user, userRole } from '../src/lib/server/db/schema/index.ts';

try {
	process.loadEnvFile();
} catch {
	// no .env: use the real environment
}

const { values } = parseArgs({
	options: {
		email: { type: 'string' },
		name: { type: 'string' },
		password: { type: 'string' },
		role: { type: 'string', default: 'admin' }
	}
});

const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
const role = values.role as (typeof userRole.enumValues)[number];

if (!email || !name) fail('--email and --name are required');
if (!userRole.enumValues.includes(role))
	fail(`--role must be one of ${userRole.enumValues.join(', ')}`);
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');

const generated = !values.password;
const password = values.password ?? randomBytes(12).toString('base64url');
if (password.length < 8) fail('password must be at least 8 characters');

const db = createDb(process.env.DATABASE_URL);

const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
if (existing) fail(`a user with email ${email} already exists`);

const userId = randomUUID();
await db.transaction(async (tx) => {
	await tx.insert(user).values({ id: userId, email, name, role, emailVerified: true });
	// Better Auth's email + password login reads the hash from the 'credential' account
	await tx.insert(account).values({
		id: randomUUID(),
		userId,
		accountId: userId,
		providerId: 'credential',
		password: await hashPassword(password)
	});
});

console.log(`Created ${role} ${name} <${email}>`);
if (generated) console.log(`Password: ${password}`);
process.exit(0);

function fail(message: string): never {
	console.error(`Error: ${message}`);
	process.exit(1);
}
