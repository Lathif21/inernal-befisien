# 05 — Phases & Task Backlog

Phases are done in order. Each task is sized so Claude Code can finish it in one session.
Prompt template: **"Implement P1-04 from docs/05-PHASES.md. Follow CLAUDE.md. Show me the plan before writing code."**

Legend: `[ ]` to do · `[x]` done · **Depends:** the task(s) that must be finished first

---

## Phase 0 — Foundation

Goal: an empty but deployed, branded app where the 2 admins can log in.

### [x] P0-01 Project scaffold

- `npx sv create befisien-crm` (minimal, TypeScript, Svelte 5), then add Tailwind v4, ESLint and Prettier
- Add `adapter-node`. Set `TZ=Asia/Jakarta` handling in `format.ts`.
- **Done when:** `npm run dev` shows a page, lint passes, and the repo is pushed to GitHub (private).

### [x] P0-02 Neon + Drizzle

**Depends:** P0-01

- Create a Neon project (Singapore) with branches `main` and `dev`
- Set up Drizzle (`postgres-js` driver, `prepare: false`), `drizzle.config.ts` using `DATABASE_URL_UNPOOLED`
- Create `db/client.ts` (`createDb(url)`, relative imports only) and `db/index.ts`
- npm scripts: `db:generate`, `db:migrate`, `db:studio`
- **Done when:** a first migration runs on the `dev` branch.
- _Note: development currently uses a local Postgres 18 database (`befisien_crm_dev`) instead of a Neon `dev` branch. The Neon project (Singapore, `main` + `dev`) still has to be created before P0-05._

### [x] P0-03 Auth (Better Auth)

**Depends:** P0-02

- `npx sv add better-auth`, email + password, `disableSignUp: true`
- Add `role`, `phone`, `digestEnabled` columns to `user`
- `hooks.server.ts` session → `locals.user`. `(app)/+layout.server.ts` guard.
- `scripts/create-user.ts` (email, name, password, role)
- **Done when:** both admins can log in and out. `/` redirects to `/login` when logged out. Sign-up is impossible.
- _Note: one admin (`nama@befisien.com`) exists in local dev; create the second with `npm run user:create` once their details are known. Production admins are created in P0-05._

### [x] P0-04 Design system & app shell

**Depends:** P0-01

- Tokens from `06-DESIGN-SYSTEM.md` in `app.css` (`@theme`). Plus Jakarta Sans.
- Init shadcn-svelte and theme it (radius, colours)
- `Sidebar`, `Topbar`, `Drawer`, `Money`, `StatTile`, `Avatar`, `EmptyState`, `Toast`
- Login page per `03-SCREENS.md` §1 (with the hero 3D image)
- Copy the 3D images from the website into `static/illustrations/`
- **Done when:** the logged-in shell looks like the design, works at phone width, and all sidebar links route to placeholder pages.
- _Note: the shadcn-svelte CLI needs an interactive preset and its default grey theme conflicts with the design system, so components are built on `bits-ui` (the primitives shadcn-svelte uses) + `svelte-sonner`, styled with the `bf-*` recipes. Login hero is composed from the befisien.com layers (`hero-base` + chat / dot / gear). `finance.webp` does not exist on the site yet (needed for the empty Invoice state in P2)._

### [ ] P0-05 Deploy to VPS

**Depends:** P0-03, P0-04

- Dockerfile, `docker-compose.yml`, Nginx block, Certbot for `crm.befisien.com`
- Production Neon `main` migrated. Admin users created.
- **Done when:** `https://crm.befisien.com` serves the app over HTTPS and survives a VPS reboot.
- _Note: staging is live on Vercel first (https://befisien-crm.vercel.app, project `befisien/befisien-crm`, functions in `cle1`) against Neon `long-truth-57557441` / branch `production` (aws us-east-2, migrated, admin created). The VPS deploy is still open._

---

## Phase 1 — MVP: CRM + basic finance

Goal: the team runs all client follow-up and money tracking in the app instead of notes.

### [x] P1-01 CRM schema

**Depends:** P0-02

- Enums and tables: `client`, `contact`, `deal`, `project`, `strategy_plan`, `action`, `activity`, `category`, `transaction` (see `02-DATA-MODEL.md`). `ai_suggestion` comes in P2-01.
- Check constraints, partial unique indexes, other indexes
- `scripts/seed.ts`: categories plus a realistic demo dataset (8 clients, 12 deals across stages, 4 projects, 30 transactions) for the `dev` branch only
- **Done when:** migration applied on `dev`, seed runs, Drizzle Studio shows the data.
- _Note: Neon branch `dev` (`br-bold-snow-b52shugd`, no expiry) is the local dev database; `npm run db:seed` refuses any target that is not `dev` or localhost, and `--reset` wipes CRM + finance tables. `ai_suggestion` FKs (`from_suggestion_id`) and `category.is_overhead` are added in Phase 2. Migration `0002_crm_finance` is not yet applied to `production`._

### [x] P1-02 Shared helpers & services skeleton

**Depends:** P1-01

- `format.ts`: `rupiah`, `rupiahShort`, `dateID`, `phoneNormalize`, plus unit tests (Vitest)
- `constants.ts`: stage lists with labels and colours, service types, sources
- `services/activity.ts`: `logActivity(tx, …)`
- **Done when:** the tests pass.

### [x] P1-03 Clients list + create/edit

**Depends:** P1-02, P0-04

- `/clients` table with search, filters and sort (server-side via URL params)
- Drawer form (Superforms + Zod) for create/edit. Archive action.
- **Done when:** clients can be added, edited, archived and searched. Validation errors show inline.

### [x] P1-04 Client detail + contacts + activity timeline

**Depends:** P1-03

- `/clients/[id]` header, tabs Ringkasan / Kontak / Deal & Proyek / Aktivitas (Keuangan comes in P1-09)
- Contacts CRUD (one primary). WhatsApp link `https://wa.me/{phone}`.
- Activity composer (type + text) and timeline
- **Done when:** contacts and notes work, and the timeline shows newest first.

### [x] P1-05 Generic Kanban component

**Depends:** P0-04

- `KanbanBoard` / `KanbanCard` with `svelte-dnd-action`, column config, collapsed columns, horizontal scroll with snap on mobile
- `onMove(cardId, toStage, beforeId, afterId)` callback. Optimistic update with rollback.
- "Pindah ke…" menu as the touch/keyboard alternative
- **Done when:** a demo board with fake data drags smoothly on desktop, and the menu works on a phone.

### [x] P1-06 Sales Pipeline board

**Depends:** P1-05, P1-04

- `/pipeline` load: open deals plus won/lost from the last 30 days, with client, owner and open next action
- `services/deals.ts`: `createDeal`, `moveDeal` (transaction: stage, position via fractional index, `stage_changed_at`, activity log)
- Lost modal (reason required). Won modal ("Deal menang! Buat proyek sekarang?") → `createProjectFromDeal`, which also sets the project's first next action.
- Column totals. Filters. Deal drawer (details + timeline).
- **Done when:** all stage moves persist with correct order after a refresh, won creates a linked project, and lost requires a reason.
- _Note: pulled forward for the cards: `NextActionBox` + `lib/next-action.ts` (WIB late / today / upcoming with midnight tests; P1-07 keeps adding / completing steps and the "+ Tambah langkah" button) and `MoneyInput` (listed in P1-09). `services/actions.ts` has the read side (`getNextActions`)._

### [ ] P1-07 Steps (actions) & next action on cards

**Depends:** P1-06

- `services/actions.ts`: `addAction`, `completeAction`, `getNextActions(cardIds)` (earliest open step per card), activity log
- `StepForm` with **date + time** (WIB). Quick buttons Besok / +3 hari / +1 minggu.
- `NextActionBox` on cards (none / upcoming / today / late, with time)
- "Langkah berikutnya?" popover when the last open step of a card is completed (skip only for won / lost / done), with an optional "Pindahkan ke [next stage]"
- **Done when:** a card always shows its earliest open step, late and today states are correct around midnight WIB and for times earlier today (unit tests), and completing the last step asks for the next one.

### [ ] P1-07b Shared period filter

**Depends:** P0-04

- `PeriodFilter` component: Harian / Mingguan / Bulanan / Tahunan / Custom, prev/next, label, URL params
- `lib/period.ts`: `resolvePeriod(params) → { from, to, prevFrom, prevTo, bucket }` in WIB, weeks starting Monday, plus unit tests
- **Done when:** the same component and helper drive every page that has a period filter.

### [ ] P1-07c Strategi screen

**Depends:** P1-07, P1-07b

- `services/plans.ts`: create / edit plan, add / reorder steps, mark achieved / dropped, move plan to project on won
- `/strategy`: Perlu perhatian (late + today, ignores the period), Rencana strategi (PlanCard + StepRow + inline StepForm), Jadwal (by day and time, follows the period), search, Semua / Saya
- **Pagination:** plans 3 per page (`?plans=n`, server `limit/offset` + total count). Steps 4 per card, loaded per page from `GET /strategy/plans/[id]/steps?page=n`. The first load includes only the page holding each plan's first unfinished step.
- Leave a placeholder slot for **Saran AI** (filled in P2-02)
- Sidebar badge = late + due today for the current user
- **Done when:** plans and steps can be fully managed, the filters work together, and ticking a step on Strategi updates the kanban card's next action.

### [ ] P1-08 Project Delivery board

**Depends:** P1-07

- `/projects` reusing the Kanban component. `services/projects.ts` `moveProject`.
- Card payment progress (paid income ÷ contract value). Project drawer.
- **Done when:** projects move across stages and show the next action and payment progress.

### [ ] P1-09 Transactions & client finance

**Depends:** P1-02

- `services/transactions.ts`: create / update / delete with activity log
- `MoneyInput`. Transaction drawer (Pemasukan / Pengeluaran toggle, status Sudah dibayar / Direncanakan).
- `/finance` page: period filter, KPI tiles, filterable table
- Client detail **Keuangan** tab and finance summary strip, with **search**, **period filter** (default Tahunan) and **Semua / Masuk / Keluar** working together, "Menampilkan x dari y transaksi", and an empty-result message
- **Done when:** totals on the client page, the project card and `/finance` match a hand-calculated check on the seed data.

### [ ] P1-10 Dashboard

**Depends:** P1-07b, P1-09

- `services/reports.ts`: KPIs for any period plus "vs periode sebelumnya" deltas, time series by bucket, per-client series (top 10 + Lainnya), pipeline summary (current), top 5 clients by profit in the period
- Dashboard per `03-SCREENS.md` §2: **no search or add buttons**, period filter in the header, `GroupedBarChart` with **View by Waktu / Klien** (vertical bars in both)
- **Done when:** every number follows the period, the Klien view total equals the Waktu view total for the same period, the numbers match `/finance`, and the page loads in under 1 second on production.

### [ ] P1-11 CSV import

**Depends:** P1-04

- Settings → Import Data: upload `import-template.csv` → parse (`papaparse`) → preview with row errors → import in one DB transaction
- Creates clients and contacts, and optionally an initial deal (stage + next action) per row
- **Done when:** the sample file imports, invalid rows are listed and skipped, and nothing is half-imported on error.

### [ ] P1-12 Telegram bot + daily digest with Trigger.dev

**Depends:** P1-07c

- Create the bot with @BotFather. `notify/telegram.ts`. `POST /api/telegram` webhook with secret header. Settings → "Hubungkan Telegram" one-time code flow.
- Install `@trigger.dev/sdk`. `trigger.config.ts` with `dirs: ['./src/trigger']`.
- `daily-digest` scheduled task (07:30 Asia/Jakarta): late / today (with times) / tomorrow, sent to **Telegram** and **email** (Resend, from `info@befisien.com`, Befisien style, button "Buka Strategi")
- Settings → digest on/off and channels per user
- **Done when:** both users have linked Telegram, a test run sends the correct Telegram message and email, nothing is sent on empty days, and it is deployed. (Telegram in Phase 1 is a proposal waiting for confirmation, see README.)

### [ ] P1-13 Settings: users & categories

**Depends:** P0-03, P1-01

- Users list, add user, reset password, digest toggle
- Categories CRUD and reorder
- **Done when:** a new user can be added from the UI and log in.

### [ ] P1-14 Phase 1 hardening

**Depends:** all P1 tasks

- Empty states, loading skeletons, error pages (`+error.svelte`)
- Mobile pass on every page
- Playwright smoke tests: login, create client, move deal to won → project, add transaction, dashboard totals
- **Done when:** the Phase 1 acceptance criteria in `01-PRD.md` §8 all pass on production, and the notes are imported.

---

## Phase 2 — AI suggestions, invoices & full finance

> AI suggestions in Phase 2 is a proposal waiting for confirmation (see README). AI provider and model are still open.

### [ ] P2-01 AI suggestion schema & service

- `ai_suggestion` table and enums. `services/aiSuggestions.ts`: build the client context, call the LLM with structured JSON output, validate with Zod, store, `input_hash` skip, accept → action or plan (`from_suggestion_id`), dismiss, expire.
- Prompt file `src/lib/server/ai/prompts/suggest.md` (Bahasa Indonesia, max 3, concrete and dated, no invented facts)
- **Done when:** on the seed data, the service returns valid suggestions for each active client, and accepting one creates a step with the right date and time.

### [ ] P2-02 Saran AI on Strategi & client page

- `AiSuggestionCard` (purple AI accent), Saran AI column on Strategi, a section on the client Ringkasan tab
- "Minta saran AI" on a plan triggers the `ai-suggest-now` task and shows a loading state
- **Done when:** accept and dismiss work, are logged in the activity timeline, and the disclaimer is visible.

### [ ] P2-03 Trigger.dev AI jobs

- `ai-suggestions` (06:30 WIB, active clients only), `ai-suggest-now` (on demand), `ai-expire-suggestions` (00:30)
- The digest mentions "x saran AI baru"
- **Done when:** the daily run completes for all active clients, and unchanged clients are skipped (visible in the run log).

### [ ] P2-04 Invoice schema + numbering

- `invoice`, `invoice_item`, `invoice_status`. Number generator `INV/BEF/{YYYY}/{MM}/{seq}` (sequence per month, safe under concurrency).
- `client.npwp` shown on the invoice

### [ ] P2-05 Invoice editor & list

- Items table, PPN 11% toggle, PPh 23 (2%) toggle, live totals computed again on the server, due date, notes
- Status flow: draft → sent → partial / paid. Void.

### [ ] P2-06 Invoice PDF

- Befisien-branded PDF (logo, company details, bank account, NPWP, terbilang). Download from the editor.

### [ ] P2-07 Payments against invoices

- "Catat Pembayaran" creates an income transaction linked by `invoice_id`. Status updates automatically (partial / paid).

### [ ] P2-08 Overhead costs & Laba Rugi

- `category.is_overhead`. Expense without a client. Finance tab **Laba Rugi**: monthly table of income, direct costs, gross profit, overhead and net.

### [ ] P2-09 Trigger.dev: invoice jobs

- `invoice-mark-overdue` (00:15 WIB), `invoice-due-reminder` (08:00 WIB, due in 3 days). Both are listed in the digest.

---

## Phase 3 — Productivity

- [ ] **P3-01** Attachments (Cloudflare R2, presigned upload) on client, project, transaction and invoice
- [ ] **P3-02** befisien.com contact form → `POST /api/leads` (secret token) → new client + deal in `lead` with a step "Hubungi lead baru" due today
- [ ] **P3-03** Global search (`pg_trgm`), opened with `Ctrl+K`
- [ ] **P3-04** Export to Excel (transactions, invoices, P&L)
- [ ] **P3-05** Recurring income for maintenance projects (`recurring-income` task)
- [ ] **P3-06** Weekly summary (Monday 08:00 WIB, Telegram + email)
- [ ] **P3-07** WhatsApp channel (Fonnte or WA Cloud API) once Telegram is proven

## Phase 4 — Later

- [ ] **P4-01** Restricted roles `sales` / `finance` with permission checks per route and action
- [ ] **P4-02** AI drafts follow-up messages (WhatsApp / email) for a step, and summarises a client's history
- [ ] **P4-03** Client portal (read-only invoices and project status)
