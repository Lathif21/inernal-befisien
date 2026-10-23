// Runs AI suggestions for every active client of the database in .env (P2-01 check, and a manual
// run before the Trigger.dev jobs exist). Costs real AI tokens.
//   npx tsx scripts/ai-suggest.ts [--force] [--accept-one]
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { DEFAULT_AI_MODEL, sumopodClient } from '../src/lib/server/ai/client.ts';
import { createDb } from '../src/lib/server/db/client.ts';
import { client, user } from '../src/lib/server/db/schema/index.ts';
import {
	acceptSuggestion,
	activeClientIds,
	generateSuggestions,
	listOpenSuggestions
} from '../src/lib/server/services/ai-suggestions.ts';
import { dateToWibLocal } from '../src/lib/format.ts';

try {
	process.loadEnvFile();
} catch {
	// no .env
}
const { values } = parseArgs({
	options: { force: { type: 'boolean' }, 'accept-one': { type: 'boolean' } }
});
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const db = createDb(process.env.DATABASE_URL);
const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
const complete = sumopodClient({
	apiKey: process.env.SUMOPOD_API_KEY ?? '',
	model,
	baseUrl: process.env.AI_BASE_URL
});

const ids = await activeClientIds(db);
console.log(`${ids.length} active clients · model ${model}${values.force ? ' · forced' : ''}`);
let tokens = { input: 0, output: 0 };
for (const id of ids) {
	const [c] = await db.select({ name: client.name }).from(client).where(eq(client.id, id));
	const t0 = Date.now();
	try {
		const r = await generateSuggestions(db, id, { complete, force: values.force });
		if (r.status === 'skipped') {
			console.log(`\n- ${c.name}: skipped (nothing changed)`);
			continue;
		}
		tokens = {
			input: tokens.input + (r.usage?.input ?? 0),
			output: tokens.output + (r.usage?.output ?? 0)
		};
		console.log(
			`\n- ${c.name}: ${r.count} saran · ${Date.now() - t0} ms · ${r.usage?.input ?? '?'} in / ${r.usage?.output ?? '?'} out`
		);
		for (const s of await listOpenSuggestions(db, { clientId: id }))
			console.log(
				`  [${s.kind}] ${s.proposedAction}\n      → ${s.cardTitle ?? '(klien)'} · ${s.proposedDueAt ? dateToWibLocal(s.proposedDueAt).replace('T', ' ') + ' WIB' : 'tanpa waktu'}\n      ${s.insight}`
			);
	} catch (e) {
		console.log(`\n- ${c.name}: FAILED ${String(e).slice(0, 200)}`);
	}
}
console.log(`\ntokens: ${tokens.input} in / ${tokens.output} out`);

if (values['accept-one']) {
	const target = (await listOpenSuggestions(db)).find(
		(s) => s.proposedDueAt && (s.dealId || s.projectId)
	);
	const [u] = await db.select({ id: user.id }).from(user).limit(1);
	if (target && u) {
		const step = await acceptSuggestion(db, target.id, {}, u.id);
		console.log(
			`\naccepted "${target.proposedAction}" (proposed ${dateToWibLocal(target.proposedDueAt!).replace('T', ' ')} WIB)` +
				`\n→ step "${step.title}" due ${dateToWibLocal(step.dueAt).replace('T', ' ')} WIB on ${target.cardTitle}`
		);
	} else console.log('\nnothing to accept');
}
await db.$client.end();
