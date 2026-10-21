# CLAUDE.md — Befisien CRM

Internal CRM + finance app for Befisien Technologies. Read `docs/01-PRD.md` to `docs/06-DESIGN-SYSTEM.md` before starting any task, and `docs/design-system/README.md` plus the relevant `docs/design-system/components/<Name>/README.md` before building any UI. Tasks are defined in `docs/05-PHASES.md` by ID (e.g. `P1-06`).

## Stack

SvelteKit (Svelte 5 runes, TypeScript) · Neon Postgres · Drizzle ORM (`postgres-js`, `prepare: false`) · Better Auth · Tailwind v4 + shadcn-svelte · Superforms + Zod · svelte-dnd-action · fractional-indexing · LayerChart · Trigger.dev v4 (`@trigger.dev/sdk`) · Resend (from info@befisien.com) · Telegram Bot API · adapter-node on a VPS.

## Commands

```
npm run dev            # app
npm run check          # svelte-check + tsc
npm run lint
npm run test           # vitest
npm run db:generate    # drizzle-kit generate (after schema changes)
npm run db:migrate     # apply migrations (DATABASE_URL_UNPOOLED)
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
