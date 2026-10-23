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
- **Form actions with `use:enhance`:** SvelteKit 3 navigates to the action URL after the result, which drops the current `?search`. For simple `{ done }` / `fail(400, { error })` actions use `use:enhance={refreshThenToast()}` from `#lib/enhance.ts` (stays on the URL, reloads data, then toasts); for confirmations use `ConfirmDialog`. `goto` takes `{ replace, reset }` (no `keepFocus` / `noScroll`).
- **Route IDs include groups:** `resolve('/(app)/clients/[id]', { id })`; a `?query` may be appended inside the route string.
- **Shared form pieces:** `Field` (label + inline error), `ClientFormDrawer`, server `saveClientForm` / `runSimpleAction` in `#lib/server/forms.ts`, `FormMessage` type in `#lib/schemas/message.ts`.
- **Kanban:** `KanbanBoard` (lanes + `onMove({ id, from, to, beforeId, afterId })`, optimistic with rollback; throw an `Error` with an Indonesian message or return `false` to undo), `KanbanCard`, `MoveMenu`; pure helpers in `#lib/kanban.ts`. `beforeId` / `afterId` are the cards directly above / below; the server computes `position = generateKeyBetween(pos(before), pos(after))`. Board pages use `page-body max-w-none!`. Demo: `/dev/kanban` (dev only). svelte-dnd-action does not start a drag on buttons, so never make a whole card a button.
- **Calling a form action from code** (board moves, modals): `fetch('?/action', { method: 'POST', body: formData, headers: { 'x-sveltekit-action': 'true' } })`, then `deserialize(await res.text())` from `$app/forms`, then `await invalidateAll()` before the toast. See `routes/(app)/pipeline/+page.svelte`.
- **Other shared UI:** `Modal` (centred decision dialog), `MoneyInput` (Rp, dot thousands, posts whole Rupiah in a hidden field), `NextActionBox` + `#lib/next-action.ts` (WIB states, wording, `daysInStage`), `Drawer` has `onclose`.
- **Timeline order:** `logActivity` stamps `occurredAt` with the app clock (`new Date()`), because Postgres `now()` is frozen inside a transaction and entries written together would tie.
- **Steps:** `services/actions.ts` (`addAction`, `updateAction`, `completeAction` with `{ next, moveToNextStage }`, `listCardSteps`, `getNextActions`) works on `{ dealId } | { projectId }`. `completeAction` refuses the last open step of a non-terminal card without `next` (`ServiceError` field `next`). Pages mount `stepActions` from `#lib/server/step-actions.ts` and use `StepsPanel`, `NextStepPrompt`, `AddStepModal`, `StepFields`; `#lib/step-form.ts` holds the WIB quick dates and form fields. "Pindahkan ke …" uses `NEXT_DEAL_STAGE` / `NEXT_PROJECT_STAGE`.
- **Proyek board:** `services/projects.ts` (`listBoardProjects` with `paid` = paid income, `getProjectDetail`, `updateProject`, `moveProject`: Selesai stamps `finished_at`, Maintenance keeps it, earlier stages clear it). Card order helpers for both boards live in `services/board-position.ts`. `PaymentProgress` (`#lib/components/projects/`) is the paid ÷ contract bar; reuse it on the client page (P1-09).
- **Finance:** `services/transactions.ts` (`listTransactions` returns the page plus `total` / `all` / paid sums of the filtered set for "Menampilkan x dari y", `financeTotals` for KPI tiles and the client strip, create / update / delete with a `transaction` activity). Pages mount `transactionActions` from `#lib/server/transaction-actions.ts` and use `TransactionFormDrawer` + `TransactionTable` (`#lib/components/finance/`). `delta()` in `#lib/finance.ts` builds StatTile deltas (none when the previous period is 0). `ConfirmDialog` has `onsuccess`.
- **Dashboard / reports:** `services/reports.ts` (`dashboardKpis`, `timeSeries` with `bucketStarts` / `bucketLabel` / `bucketTitle` from `#lib/period.ts`, `clientTotals` → `topClientsSeries` (top 10 + Lainnya) and `topClientsByProfit`, `pipelineSummary`). All money comes from paid transactions with the same filters as Keuangan, so the numbers match. Charts: `#lib/components/charts/GroupedBarChart.svelte` (plain SVG; legend, keyboard tooltips, "Lihat tabel"). Grid children with truncated text need `min-w-0` (`*:min-w-0` on the grid), or they widen the column on phones. `resolve()` with a query on the home page: `resolve(\`?${qs}\`)`, not `/(app)?…` (the group would stay in the URL).
- **CSV import:** `#lib/import/client-csv.ts` (papaparse + checks, pure, Indonesian row errors; `templateCsv()`), `services/import.ts` (`previewImport`, `runImport`: one transaction reusing `createClient` / `saveContact` / `createDeal` / `moveDeal`). Route `/settings/import` posts the file to `?/preview`, then the same text to `?/import`, which validates again. Don't write a literal BOM in source (lint `no-irregular-whitespace`); use `String.fromCharCode(0xfeff)`.
- **Telegram + digest (P1-12):** `services/digest.ts` (`getDigestItems` late / today / tomorrow in WIB, `digestTelegram` / `digestEmail` texts, `sendDigest` per user, `runDailyDigest`), senders in `src/lib/server/notify/` (plain `fetch`, keys passed in; the app wires them in `#lib/server/digest-senders.ts`, the task in `src/trigger/daily-digest.ts` from `process.env`). Linking: `services/telegram-link.ts` (one-time 10-char code, 15 min) + public webhook `src/routes/api/telegram/+server.ts` (checks `X-Telegram-Bot-Api-Secret-Token`, replies in the response body). Webhook registration: `setWebhook` with `url=<app>/api/telegram`, `secret_token=TELEGRAM_WEBHOOK_SECRET`, `allowed_updates=["message"]`; re-run it when the app URL changes (VPS). Trigger.dev task env vars (set in its dashboard per environment): `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`.
- **Settings (P1-13):** `services/users.ts` (`createUser` / `resetPassword` write Better Auth's `credential` account with `hashPassword`; reset deletes the user's sessions) and `services/categories.ts` (unique name per type, `sort` per type, delete only unused). Admin pages call `requireRole(locals, 'admin')`.
- **Strategi:** `services/plans.ts` (`listPlans` 3 per page with only the step page holding the first open step, `planStepsPage` behind `GET /strategy/plans/[id]/steps`, `attentionSteps`, `scheduleSteps`, plan CRUD, `addPlanStep`, `moveStep`). `attentionCount` (late + today, current user) is loaded in `(app)/+layout.server.ts` for the sidebar badge. Components live in `#lib/components/strategy/` (`PlanCard`, `StepRow`, `PlanFormDrawer`).
- **Superforms 3:** `superValidate(request, zod4(schema))` with `zod4` from `sveltekit-superforms/adapters` (Zod 4). `valibot` is installed only because the adapters entry imports it. Pass `untrack(() => data.form)` to `superForm`. Its return values are stores (`$form`, `$errors`); that is fine.

## Database notes

- **Correlated subqueries:** Drizzle leaves columns unqualified when a query reads one table, so in `sql\`(select … from ${deal} where …)\``write every column as`"table"."column"`(see`col()`in`services/clients.ts`). Unqualified `"id"` silently resolves to the inner table.
- **Neon from here is slow to connect (~2.5 s per new connection, US region).** The pool keeps idle connections 60 s and every client has an `error` listener (see `db/client.ts`); keep both, or a dropped connection crashes the process.
- **DB tests:** `*.db.spec.ts` run against the Neon `dev` branch inside a rolled-back transaction and skip when no dev database is configured. Give them `{ timeout: 30_000 }`.

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
- Period filter: always use `resolvePeriod()` from `#lib/period.ts` in the load (URL `?period=month&from=…[&to=…]`, WIB, weeks start Monday) and the `PeriodFilter` component with an `href(changes)` built by the page with `resolve()`, so other filters survive. Defaults: Dashboard Bulanan, Strategi Mingguan, client transactions Tahunan. Deltas: `prevFrom`–`prevTo` (previous calendar month / year for Bulanan / Tahunan, otherwise the same number of days). Day columns compare with `from` / `to` strings; timestamptz columns with `fromInstant` / `toInstant` (end exclusive).
- `won` → offer to create a project. `lost` → reason required.
- Transaction `amount` is always positive. `type` gives the direction. Profit = paid income − paid expense.
