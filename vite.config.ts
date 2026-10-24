import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';

// Vercel sets VERCEL=1 during its builds (staging); everywhere else builds for the VPS (`node build`).
// cle1 = Cleveland, next to the Neon database (aws us-east-2): every query is a round trip.
// maxDuration: "Minta saran AI" waits for the model (10-30 s)
const adapter = process.env.VERCEL
	? vercelAdapter({ regions: ['cle1'], maxDuration: 60 })
	: nodeAdapter();

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.db.spec.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					// Neon dev branch tests: one file at a time, so parallel files do not starve the
					// slow connections (~2.5 s each) into timeouts
					name: 'db',
					environment: 'node',
					include: ['src/**/*.db.spec.ts'],
					fileParallelism: false
				}
			}
		]
	}
});
