// Allow the app's pages to upload Email page files straight to the Neon bucket (P3-08).
// Usage: npm run storage:cors -- --origin https://befisien-crm.vercel.app [--origin …]
//        [--env-file .env.prod-storage]
// Reads NEON_STORAGE_* (or the AWS_* names `neon env pull` writes) from .env, or from --env-file
// instead, so it applies to the branch those credentials belong to (.env = dev). Re-run when the
// app's URL changes (VPS).
import { allowBrowserUploads, storageConfig } from '../src/lib/server/storage/files';

const arg = (name: string) =>
	process.argv.flatMap((a, i, all) => (a === name && all[i + 1] ? [all[i + 1]] : []));

const envFile = arg('--env-file')[0];
try {
	process.loadEnvFile(envFile ?? '.env');
} catch {
	if (envFile) {
		console.error(`Cannot read ${envFile}`);
		process.exit(1);
	}
	// no .env: use the real environment
}

const origins = arg('--origin').map((o) => o.replace(/\/$/, ''));
if (!origins.length) {
	console.error('Pass at least one --origin, e.g. --origin https://befisien-crm.vercel.app');
	process.exit(1);
}
const config = storageConfig(process.env);
if (!config) {
	console.error('No storage credentials: run `neon env pull` or set NEON_STORAGE_*');
	process.exit(1);
}
await allowBrowserUploads(config, origins);
console.log(`Browser uploads allowed on ${config.bucket} (${new URL(config.endpoint).host}) from:`);
for (const o of origins) console.log(`  ${o}`);
