import { attachDatabasePool } from '@vercel/functions';
import { building } from '$app/env';
import { DATABASE_URL } from '$app/env/private';
import { createDb } from './client';

if (!DATABASE_URL && !building) throw new Error('DATABASE_URL is not set');

// pg connects lazily, so the placeholder is never dialled during `vite build`
export const db = createDb(DATABASE_URL ?? 'postgres://build@localhost/build');

// On Vercel (Fluid compute) this keeps the instance alive until idle connections are closed;
// it is a no-op everywhere else (VPS, local dev).
attachDatabasePool(db.$client);

export type { Db, Tx } from './client';
