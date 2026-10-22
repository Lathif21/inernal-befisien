# CLAUDE.md — Befisien CRM

Internal CRM + finance app for Befisien Technologies. Read `docs/01-PRD.md` to `docs/06-DESIGN-SYSTEM.md` before starting any task, and `docs/design-system/README.md` plus the relevant `docs/design-system/components/<Name>/README.md` before building any UI. Tasks are defined in `docs/05-PHASES.md` by ID (e.g. `P1-06`).

## Stack

SvelteKit 3 (Svelte 5 runes, TypeScript) · Neon Postgres (project `long-truth-57557441`, branches `production` (staging) and `dev` (local `.env`, demo seed), aws us-east-2; linked via `neon.ts` / `.neon`; switch with `neon checkout <branch>`) · Drizzle ORM with `node-postgres` (`pg`) on the pooled URL, `attachDatabasePool` on Vercel · Better Auth · Tailwind v4 + bits-ui primitives + svelte-sonner (instead of the shadcn-svelte CLI) · Lucide (`@lucide/svelte`) · Superforms + Zod · svelte-dnd-action · fractional-indexing · LayerChart · Trigger.dev v4 (`@trigger.dev/sdk`) · Resend (from info@befisien.com) · Telegram Bot API · Staging on Vercel (`befisien/befisien-crm`, https://befisien-crm.vercel.app, region `cle1`, adapter-vercel when `VERCEL=1`) · Production planned on a VPS with adapter-node.

## SvelteKit 3 notes (the docs were written for SvelteKit 2)

- **Imports:** there is no `$lib` alias. Use `#lib/...` with the file extension: `import { db } from '#lib/server/db/index.ts'`. Files shared with Trigger.dev still use relative imports.
- **Env vars:** declare each one in `src/env.ts` (`defineEnvVars`), read them from `$app/env/private` / `$app/env/public`. `dev` / `building` come from `$app/env`.
- **Links:** internal `href`s go through `resolve()` from `$app/paths` (lint rule). Paths have **no leading slash**: `resolve('clients')`, `''` for home. Types: `Path` from `$app/types`.
- **Config** lives in `vite.config.ts` (`sveltekit({...})`); there is no `svelte.config.js`.
- **Origin / CSRF in production:** adapter-node 6 ignores `ORIGIN`. It derives the origin from the `Host` header and assumes https; behind Nginx set `PROTOCOL_HEADER=x-forwarded-proto`. Better Auth uses `BETTER_AUTH_URL`.
- **Inputs:** use `defaultValue={…}` (not `value={…}`) for server-provided initial values, so text typed before hydration is kept.
- **UI primitives:** build drawers, dialogs, menus, selects and popovers on `bits-ui`, styled with the `bf-*` recipes (`src/lib/styles/bf.css`) and theme classes. Toasts: `toast` from `#lib/toast.ts`.

## Commands

```
npm run dev            # app
npm run check          # svelte-check + tsc
npm run lint
npm run test           # vitest
npm run db:generate    # drizzle-kit generate (after schema changes)
npm run db:migrate     # apply migrations (DATABASE_URL_UNPOOLED)
npm run user:create -- --email … --name "…" [--password …] [--role admin]
npm run db:seed [-- --reset]   # demo data; only on Neon `dev` or localhost
npm run db:studio
npx trigger.dev@latest dev
```

## How to work

1. Restate the task ID and its "Done when" list. Propose a short plan **before** coding.
2. Keep changes inside the task's scope. If something outside it is needed, say so instead of doing it silently.
3. Finish with: `npm run check`, `npm run lint`, `npm run test`, and the task's "Done when" checklist with each item marked.
4. Never edit an applied migration. Create a new one.
5. Update the checkbox in `docs/05-PHASES.md` when the task is complete.

## Code rules

- **Svelte 5 runes only** (`$state`, `$derived`, `$props`, `$effect`). No legacy `export let` or stores in new code.
- **Business logic lives in `src/lib/server/services/`.** Routes validate input with Zod and call services. Services take `db` (or a transaction) as their first argument so Trigger.dev tasks can reuse them.
- **Multi-step writes** (stage change + activity log, won → project) run in `db.transaction()`.
- `src/lib/server/db/client.ts` and `schema/*` must **not** import `$env`, `$lib` or `@sveltejs/kit`. Use relative imports (shared with Trigger.dev).
- **Money:** `bigint` whole Rupiah in the DB, `number` in TS. Never floats with decimals. Format only with `rupiah()` / `rupiahShort()` from `$lib/format`.
- **Dates:** transaction dates are `date`. Step due times are `timestamptz`, entered and shown in WIB. "Today" and "late" are calculated in `Asia/Jakarta` with `@date-fns/tz`. Never rely on the server's local time.
- **Phones:** store normalised `628…` via `phoneNormalize()`.
- Every form action checks `locals.user`, even under the guarded layout.
- **UI copy is Bahasa Indonesia.** Code, comments and commit messages are English.
- Follow `docs/design-system/tokens.json` (token names = CSS variable names, e.g. `--color-accent-ink`). Match the markup and states in `docs/design-system/components/bundle.css`. No hard-coded hex values in components; use the theme classes. Lucide icons, no emoji.
- Accessibility: real `<button>` / `<a>` elements, labels on inputs, `aria-label` on icon buttons, a keyboard alternative for drag & drop ("Pindah ke…" menu).

## Domain cheat-sheet

- Deal stages: `lead → contacted → meeting → proposal → negotiation → won | lost`
- Project stages: `onboarding → in_progress → review → done → maintenance`
- Steps live in `action` (date + time, optional `plan_id`). A card's next action = its earliest open step. Every active card keeps at least one open step (enforced in services).
- Strategy plans: `strategy_plan` (goal, target, steps). AI suggestions (`ai_suggestion`) are never applied without a user clicking accept.
- Period filter: always use `lib/period.ts` (WIB, weeks start Monday). Deltas compare with the previous period of the same length.
- `won` → offer to create a project. `lost` → reason required.
- Transaction `amount` is always positive. `type` gives the direction. Profit = paid income − paid expense.
