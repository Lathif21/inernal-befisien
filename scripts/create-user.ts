// Creates a login for the CRM (public sign-up is disabled).
// npm run user:create -- --email a@befisien.com --name "Nama" [--password …] [--role admin]
import { parseArgs } from 'node:util';
import { createDb } from '../src/lib/server/db/client.ts';
import { userRole } from '../src/lib/server/db/schema/index.ts';
import { ServiceError } from '../src/lib/server/services/errors.ts';
import { createUser } from '../src/lib/server/services/users.ts';

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

if (values.password && values.password.length < 8) fail('password must be at least 8 characters');

const db = createDb(process.env.DATABASE_URL);
try {
	const created = await createUser(db, { email, name, role, password: values.password });
	console.log(`Created ${role} ${name} <${created.email}>`);
	if (created.generated) console.log(`Password: ${created.password}`);
} catch (e) {
	fail(e instanceof ServiceError ? e.message : String(e));
}
process.exit(0);

function fail(message: string): never {
	console.error(`Error: ${message}`);
	process.exit(1);
}
