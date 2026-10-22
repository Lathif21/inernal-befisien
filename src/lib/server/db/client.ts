// Shared with Trigger.dev tasks: relative imports only, no $env / $lib / @sveltejs/kit.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';

/**
 * `url` is the Neon pooled connection string (-pooler). node-postgres is Neon's recommended
 * driver on Vercel (with attachDatabasePool) and on long-running Node (VPS, Trigger.dev).
 * The pool is available as `db.$client`.
 */
export function createDb(url: string) {
	const pool = new Pool({ connectionString: url });
	return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** First argument of every service: the app's db, a Trigger.dev task's db, or an open transaction */
export type DbOrTx = Db | Tx;
