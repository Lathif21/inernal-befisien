import { defineConfig } from 'drizzle-kit';

try {
	process.loadEnvFile();
} catch {
	// no .env file: rely on the real environment (CI, VPS)
}

if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema/index.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED },
	strict: true,
	verbose: true
});
