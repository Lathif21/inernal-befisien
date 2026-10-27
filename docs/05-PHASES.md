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
- _Decision (24 Okt 2026): the Vercel deployment is production for now and holds the real data; the VPS is deferred. Optional: point `crm.befisien.com` at Vercel (one DNS record). Note: Vercel's free Hobby plan is for non-commercial use; a company tool belongs on Pro. When moving to the VPS, keep the same Neon branch and re-run Telegram `setWebhook` with the new URL (CLAUDE.md "Telegram + digest")._

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

### [x] P1-07 Steps (actions) & next action on cards

**Depends:** P1-06

- `services/actions.ts`: `addAction`, `completeAction`, `getNextActions(cardIds)` (earliest open step per card), activity log
- `StepForm` with **date + time** (WIB). Quick buttons Besok / +3 hari / +1 minggu.
- `NextActionBox` on cards (none / upcoming / today / late, with time)
- "Langkah berikutnya?" popover when the last open step of a card is completed (skip only for won / lost / done), with an optional "Pindahkan ke [next stage]"
- **Done when:** a card always shows its earliest open step, late and today states are correct around midnight WIB and for times earlier today (unit tests), and completing the last step asks for the next one.

### [x] P1-07b Shared period filter

**Depends:** P0-04

- `PeriodFilter` component: Harian / Mingguan / Bulanan / Tahunan / Custom, prev/next, label, URL params
- `lib/period.ts`: `resolvePeriod(params) → { from, to, prevFrom, prevTo, bucket }` in WIB, weeks starting Monday, plus unit tests
- **Done when:** the same component and helper drive every page that has a period filter.
- _Note: `PeriodFilter` + `lib/period.ts` are built and tested (demo at `/dev/period`, dev only). Strategi (P1-07c), Keuangan and the client finance tab (P1-09) and the Dashboard (P1-10) must use them, with defaults Mingguan / Tahunan (client tab) / Bulanan._

### [x] P1-07c Strategi screen

**Depends:** P1-07, P1-07b

- `services/plans.ts`: create / edit plan, add / reorder steps, mark achieved / dropped, move plan to project on won
- `/strategy`: Perlu perhatian (late + today, ignores the period), Rencana strategi (PlanCard + StepRow + inline StepForm), Jadwal (by day and time, follows the period), search, Semua / Saya
- **Pagination:** plans 3 per page (`?plans=n`, server `limit/offset` + total count). Steps 4 per card, loaded per page from `GET /strategy/plans/[id]/steps?page=n`. The first load includes only the page holding each plan's first unfinished step.
- Leave a placeholder slot for **Saran AI** (filled in P2-02)
- Sidebar badge = late + due today for the current user
- **Done when:** plans and steps can be fully managed, the filters work together, and ticking a step on Strategi updates the kanban card's next action.
- _Note: a plan already follows its deal to the won project (`createProjectFromDeal`, P1-06). Saran AI is a placeholder section and "Minta saran AI" is disabled until P2-02._

### [x] P1-08 Project Delivery board

**Depends:** P1-07

- `/projects` reusing the Kanban component. `services/projects.ts` `moveProject`.
- Card payment progress (paid income ÷ contract value). Project drawer.
- **Done when:** projects move across stages and show the next action and payment progress.
- _Note: projects are still only created from won deals (no "+ Proyek"); the drawer edits name, service, contract value, dates and owner. Selesai is collapsed and shows the last 30 days. Payment progress counts paid income, retainers included, so Maintenance projects can pass 100%._

### [x] P1-09 Transactions & client finance

**Depends:** P1-02

- `services/transactions.ts`: create / update / delete with activity log
- `MoneyInput`. Transaction drawer (Pemasukan / Pengeluaran toggle, status Sudah dibayar / Direncanakan).
- `/finance` page: period filter, KPI tiles, filterable table
- Client detail **Keuangan** tab and finance summary strip, with **search**, **period filter** (default Tahunan) and **Semua / Masuk / Keluar** working together, "Menampilkan x dari y transaksi", and an empty-result message
- **Done when:** totals on the client page, the project card and `/finance` match a hand-calculated check on the seed data.
- _Note: the client finance strip is all time (paid only, plus planned income); the Keuangan tab table follows its own filters. `/finance` KPI tiles follow the period and the client filter, not search / type / category / status. The client page's Ringkasan also shows each active project (payment progress, next action)._

### [x] P1-10 Dashboard

**Depends:** P1-07b, P1-09

- `services/reports.ts`: KPIs for any period plus "vs periode sebelumnya" deltas, time series by bucket, per-client series (top 10 + Lainnya), pipeline summary (current), top 5 clients by profit in the period
- Dashboard per `03-SCREENS.md` §2: **no search or add buttons**, period filter in the header, `GroupedBarChart` with **View by Waktu / Klien** (vertical bars in both)
- **Done when:** every number follows the period, the Klien view total equals the Waktu view total for the same period, the numbers match `/finance`, and the page loads in under 1 second on production.
- _Note: "Nilai pipeline aktif" for a period = deals open at some point in it (created before it ended, and still open or won / lost after it started), valued at today's estimate. The chart is a plain-SVG `GroupedBarChart` (no LayerChart: one chart type, exact mark specs, keyboard tooltips and a table view). Production load measured at ~370 ms median from Indonesia (staging data is small)._

### [x] P1-11 CSV import

**Depends:** P1-04

- Settings → Import Data: upload `import-template.csv` → parse (`papaparse`) → preview with row errors → import in one DB transaction
- Creates clients and contacts, and optionally an initial deal (stage + next action) per row
- **Done when:** the sample file imports, invalid rows are listed and skipped, and nothing is half-imported on error.
- _Note: the app serves its own template (`/settings/import/template.csv`, header + one valid example row); `docs/import-template.csv` still holds `[…]` placeholders, which the preview flags. Re-importing a file does not duplicate contacts (same name) or deals (same title) of a client. Notes of an existing client go to its timeline instead of overwriting. Won rows create the project (first step = next_action or "Kick-off meeting" +3 days); lost rows get the reason "Lainnya: diimpor sebagai deal batal". A date-only next_action_due becomes 09:00 WIB. Settings shows Import Data; Pengguna / Kategori / Telegram are marked "Segera" until P1-12 / P1-13._

### [ ] P1-12 Telegram bot + daily digest with Trigger.dev

**Depends:** P1-07c

- Create the bot with @BotFather. `notify/telegram.ts`. `POST /api/telegram` webhook with secret header. Settings → "Hubungkan Telegram" one-time code flow.
- Install `@trigger.dev/sdk`. `trigger.config.ts` with `dirs: ['./src/trigger']`.
- `daily-digest` scheduled task (07:30 Asia/Jakarta): late / today (with times) / tomorrow, sent to **Telegram** and **email** (Resend, from `info@befisien.com`, Befisien style, button "Buka Strategi")
- Settings → digest on/off and channels per user
- **Done when:** both users have linked Telegram, a test run sends the correct Telegram message and email, nothing is sent on empty days, and it is deployed. (Telegram in Phase 1 is a proposal waiting for confirmation, see README.)
- _Status: live on staging. Trigger.dev `daily-digest` deployed (v20261023.1, prod, 07:30 Asia/Jakarta, env vars set); a test run sent the email to nama@ (1 step) and correctly sent nothing to info@ (nothing due). info@ is linked to @Befisienbot. Update (25 Okt 2026): nama@ was removed (a placeholder account); info@ is the only user and is linked. Still open: one morning where info@ has steps (or invoices) due, to see the Telegram message arrive._

### [x] P1-13 Settings: users & categories

**Depends:** P0-03, P1-01

- Users list, add user, reset password, digest toggle
- Categories CRUD and reorder
- **Done when:** a new user can be added from the UI and log in.
- _Note: `/settings/users` (admin only): add (password typed or generated and shown once), reset password (ends that user's sessions), digest on/off per user; Telegram stays self-service in each user's Pengaturan. `/settings/categories`: add, rename, reorder per type, delete only when unused. `scripts/create-user.ts` now uses the same `services/users.ts`._

### [ ] P1-14 Phase 1 hardening

**Depends:** all P1 tasks

- Empty states, loading skeletons, error pages (`+error.svelte`)
- Mobile pass on every page
- Playwright smoke tests: login, create client, move deal to won → project, add transaction, dashboard totals
- **Done when:** the Phase 1 acceptance criteria in `01-PRD.md` §8 all pass on production, and the notes are imported.
- _Status (24 Okt 2026): error pages, navigation progress bar, empty-state pass, mobile pass (every page at 390px, staging and dev) and `npm run test:e2e` (5 smoke flows, run on dev) are done. PRD §8 on staging: sign-up refused (400) and both admins exist; boards, won → project, lost reason, steps, Strategi, dashboard (Waktu = Klien = Keuangan for 6 periods), client finance filters, CSV import and phone layout were verified per task. Open: the 07:30 digest arriving on Telegram (P1-12) and production on the VPS (P0-05). The real notes were imported (24 Okt 2026)._

---

## Phase 2 — AI suggestions, invoices & full finance

> AI suggestions confirmed (24 Okt 2026): provider Sumopod, default model `claude-opus-5-5`.

### [x] P2-01 AI suggestion schema & service

- `ai_suggestion` table and enums. `services/aiSuggestions.ts`: build the client context, call the LLM with structured JSON output, validate with Zod, store, `input_hash` skip, accept → action or plan (`from_suggestion_id`), dismiss, expire.
- Prompt file `src/lib/server/ai/prompts/suggest.md` (Bahasa Indonesia, max 3, concrete and dated, no invented facts)
- **Done when:** on the seed data, the service returns valid suggestions for each active client, and accepting one creates a step with the right date and time.
- _Note: provider is Sumopod (OpenAI-compatible gateway, `SUMOPOD_API_KEY`), model `AI_MODEL` (default `claude-opus-5-5`), JSON-schema structured output + Zod. The prompt lives in `src/lib/server/ai/prompts/suggest.ts` (a .ts file so both the app and the Trigger.dev bundle include it). The skip hash covers stable facts only and is stored on `client.ai_input_hash`; new suggestions replace a client's older open ones. Seed run (24 Okt 2026): 7 active clients, 13 suggestions, ~16.6k in / 6k out tokens; a second run skipped 6 unchanged clients. `npm run ai:suggest [-- --force] [-- --accept-one]` runs it by hand._

### [x] P2-02 Saran AI on Strategi & client page

- `AiSuggestionCard` (purple AI accent), Saran AI column on Strategi, a section on the client Ringkasan tab
- "Minta saran AI" on a plan triggers the `ai-suggest-now` task and shows a loading state
- **Done when:** accept and dismiss work, are logged in the activity timeline, and the disclaimer is visible.
- _Note: "Minta saran AI" (on a plan, and on the client page) calls the service directly from the form action and waits (10-30 s, Vercel `maxDuration` 60) instead of triggering `ai-suggest-now`; P2-03 can move it onto Trigger.dev. Accept opens an inline step form (title, WIB date / time, PIC; a deal / project picker for client-wide suggestions). The JSON schema uses plain strings ("" = none) because MiniMax rejects nullable type lists, and the parser also accepts a bare list._

### [x] P2-03 Trigger.dev AI jobs

- `ai-suggestions` (06:30 WIB, active clients only), `ai-suggest-now` (on demand), `ai-expire-suggestions` (00:30)
- The digest mentions "x saran AI baru"
- **Done when:** the daily run completes for all active clients, and unchanged clients are skipped (visible in the run log).
- _Note: `ai-suggestions` (06:30) and `ai-expire-suggestions` (00:30) run on Trigger.dev prod (v20261023.3); every schedule, the digest included, has `window: '5m'` (the default 60-minute window could start the 06:30 run after the 07:30 digest). Staging check 24 Okt 2026: run 1 = 2 clients, 3 suggestions; run 2 = both skipped. `ai-suggest-now` was not built: "Minta saran AI" runs directly in the app (20-30 s, within Vercel's 60 s). Production model: `AI_MODEL=MiniMax-M3.1-Flash-Preview` (cheaper; set on Vercel and Trigger.dev)._

### [x] P2-04 Invoice schema + numbering

- `invoice`, `invoice_item`, `invoice_status`. Number generator `INV/BEF/{YYYY}/{MM}/{seq}` (sequence per month, safe under concurrency).
- `client.npwp` shown on the invoice
- _Note: migration 0006 adds `invoice`, `invoice_item`, `invoice_status`, `invoice_counter` (one row per month, claimed with one atomic upsert inside the invoice's transaction) and `transaction.invoice_id` for P2-07. The number is assigned when the invoice is created, from the issue month, zero-padded to 3 digits (`INV/BEF/2026/10/007`); invoices are voided, not deleted, so numbers have no gaps. Totals: `lib/invoice.ts` (BigInt on scaled integers; PPN / PPh 23 rate 0 = off), recomputed on the server. Verified: 10 concurrent creates got 10 consecutive numbers; a new month restarts at 001. `getInvoice` returns the client's NPWP (stored as digits; P2-06 formats it)._

### [x] P2-05 Invoice editor & list

- Items table, PPN 11% toggle, PPh 23 (2%) toggle, live totals computed again on the server, due date, notes
- Status flow: draft → sent → partial / paid. Void.
- _Note: `/invoices` (search on number / client, status chips with counts, 25 per page), `/invoices/new` (prefill with `?client=` / `?project=`; the project's contract value goes into item 1; due date = issue + 14 days) and `/invoices/[id]` share `InvoiceEditor` (Superforms `dataType: 'json'`; the client cannot change after creation). Only a draft can be edited; its issue date must stay in the month that gave it its number. "Tandai Terkirim" makes it read-only (draft → sent). "Batalkan invoice" voids it (refused once a payment is linked). Partial / paid come from payments in P2-07; "Unduh PDF" and "Catat Pembayaran" are disabled placeholders until P2-06 / P2-07. Every change goes on the client's timeline. Verified in the browser: live totals match a hand calculation (59.000.000 + PPN 6.490.000 = 65.490.000; less PPh 23 1.180.000 = 64.310.000 received) and the server's totals; no overflow at 390 px._

### [x] P2-06 Invoice PDF

- Befisien-branded PDF (logo, company details, bank account, NPWP, terbilang). Download from the editor.
- _Note: `pdfmake` on the server (`src/lib/server/pdf/invoice-pdf.ts`), A4, Plus Jakarta Sans and the logo mark bundled into the server code (no disk reads, works on Vercel). Route `/invoices/[id]/pdf` (download; `?view` opens it in the browser), from saved data only. Contents: letterhead (logo, company name, address, phone, email, NPWP), bill-to with the client's NPWP, issue / due date and project, items, totals (taxes that are off are left out; "Jumlah ditransfer" = total − PPh 23), terbilang of the total (`#lib/terbilang.ts`), notes, bank account, signature block with city and date. Watermark DRAF / DIBATALKAN / LUNAS. Added at the user's request: **Pengaturan → Profil perusahaan** (admin, migration 0007 `company_profile`, one row). Until it is saved, example values are used (bank and NPWP are placeholders) and the invoice page and settings page say so. Ligatures are off so copied text reads "Befisien", not "Befsien"._

### [x] P2-07 Payments against invoices

- "Catat Pembayaran" creates an income transaction linked by `invoice_id`. Status updates automatically (partial / paid).
- _Note: payments are taken on sent / partial / overdue invoices (a draft is sent first). The modal (amount defaults to what is left, date today WIB, category Termin, method Transfer, reference, description defaulting to "Pembayaran INV/…") writes a paid income transaction with the invoice's client and project. **Lunas = total − PPh 23 received** (the client withholds PPh 23), so `paymentStatus()` in `#lib/invoice.ts`: paid ≥ total − PPh 23 → paid, > 0 → partial, 0 → sent or overdue after the due date. `syncInvoiceStatus` (services/invoice-status.ts) runs in the same DB transaction after every create / edit / delete of a linked transaction, also from Keuangan, and refuses a total above the invoice value or a payment moved to another client or to expense. Planned payments do not count. Logs "Invoice X lunas" / "tidak lagi lunas" on the client timeline. The invoice page shows a Pembayaran box (progress, rows with delete); Keuangan links each payment to its invoice; the list shows "sisa Rp …" on partly paid invoices. Cancelling is hidden while payments exist. No migration (`transaction.invoice_id` came with P2-04)._

### [x] P2-08 Overhead costs & Laba Rugi

- `category.is_overhead`. Expense without a client. Finance tab **Laba Rugi**: monthly table of income, direct costs, gross profit, overhead and net.
- _Note: migration 0008 adds `category.is_overhead`, makes `transaction.client_id` nullable with the check "income always has a client", and inserts the overhead categories Gaji, Sewa Kantor, Internet & Utilitas, Marketing, Langganan Tools, Pajak & Admin Bank. Rule (services/transactions.ts `checkRefs`): an overhead category stores no client and no project; every other transaction needs a client. Overhead has no client timeline, so it logs no activity. The drawer asks for the category first, groups expense categories into "Biaya proyek" / "Overhead (tanpa klien)" and hides Klien / Proyek for overhead; the client page does not offer overhead. Settings → Kategori: an expense category can be created as Overhead (badge; fixed afterwards). Keuangan lists overhead rows with "Overhead" in the client column; the Dashboard and Keuangan "Laba" now include overhead (net), per-client figures do not. **Laba Rugi** is `/finance/laba-rugi` (tab next to Transaksi, year switcher): per month paid income, direct costs (non-overhead expense), gross profit, overhead, net profit and margin, a total row, tiles for the year and overhead per category; months after the current one show "–". Cash basis, like the rest of the app._

### [x] P2-09 Trigger.dev: invoice jobs

- `invoice-mark-overdue` (00:15 WIB), `invoice-due-reminder` (08:00 WIB, due in 3 days). Both are listed in the digest.
- _Note: `services/invoice-jobs.ts` + `src/trigger/invoice-jobs.ts`. **Overdue:** only "Terkirim" invoices past their due date become "Jatuh tempo" (partly paid ones stay "Dibayar sebagian", like the P2-07 rules), logged on the client timeline. **Reminder (decided 25 Okt 2026: team only, never the client):** unpaid invoices due exactly 3 days from today go to every user with the digest on, by their digest channels; nothing when none are due; no task retry (it would message twice). **Digest:** new sections "Invoice lewat jatuh tempo" (every unpaid invoice past due, with what is left to receive) and "Invoice segera jatuh tempo" (due today to 3 days), a "Buka Invoice" link, and invoices alone are enough to send it. Settings "Kirim tes" includes them._

### [ ] P2-10 Telegram input (chat and voice note)

- Linked users send a message or a voice note to the bot. Voice is transcribed with Groq Whisper (`GROQ_API_KEY`). The AI (Sumopod, JSON schema) turns it into one draft: **lead** (client, contact and deal, with the CSV import columns and checks), **langkah** on a deal or project, **pindah tahap** of a deal, **rencana** Strategi with its steps, or **catatan** on the timeline.
- The webhook only queues the Trigger.dev task `telegram-inbound` and answers at once; the task replies with a preview and the buttons **Simpan** / **Batal**. Nothing is written before Simpan. A message sent while a draft is open may correct it ("nilainya 30 juta"). Drafts expire after 30 minutes.
- Simpan reuses the services (`importRows`, `addAction`, `moveDeal`, `createPlan` + `addPlanStep`, `logActivity`) in one transaction, under the sender's name.
- **Done when:** a text and a voice note each give a correct draft for every kind; Simpan writes it once (a second tap does nothing); Batal and expiry write nothing; a correction replaces the draft; unlinked chats get the link instructions; the webhook's `allowed_updates` includes `callback_query`.
- _Status (24 Okt 2026): built, not deployed. Migration 0009 `telegram_draft` (applied on dev). DB tests with a fake AI / Telegram cover every kind, the second tap, Batal, expiry, a correction and an unlinked chat. A read-only run with the production model (MiniMax) on the dev data gave correct drafts for a lead, a step, a stage move, a plan with 3 steps, a call note and a greeting (no draft); ~1.7k tokens in, 0.2-2k out, 3-20 s each. MiniMax ignores nested objects in the JSON schema, so plan steps are strings `YYYY-MM-DDTHH:mm | judul`. The Groq key lists `whisper-large-v3`; a real voice note is still untested. Open: deploy (Trigger.dev task + `GROQ_API_KEY`, `TRIGGER_SECRET_KEY` = prod key on Vercel, migration 0009 on production), `npm run telegram:webhook -- --url https://befisien-crm.vercel.app`, then one text and one voice note per kind in Telegram._

### [x] P2-11 Telegram strategy chat (client request, 25 Okt 2026)

- Ask the bot about one client's strategy ("strategi untuk IMR?") and discuss it in the chat; approve with a button.
- _Note: decided 25 Okt 2026: show the current plans plus an AI proposal, and allow a free conversation. `services/telegram-strategy.ts` + prompt `ai/prompts/strategy-chat.ts`; the Telegram input gets the intent `strategy`. The first answer sends an overview (active plans with progress and the next step), each open Saran AI with **Terima / Abaikan** (Terima makes the step on its card, or on the client's only card), and the AI's answer from the whole client context (Ringkasan konteks included). The AI may propose a **new plan** for a deal / project or an **update** of an active plan (existing open steps by ref L1… moved or renamed, new steps added; done steps untouched, nothing deleted from chat); the message shows each change with its old date, and **Simpan** writes it through `createPlan` / `addPlanStep` / `updateAction`, once. Follow-ups within 30 minutes continue the conversation (`telegram_draft` kind `strategy`, history and proposal in `payload`); a message clearly about something else goes to the normal Telegram input, asking about another client closes the old conversation. Weekdays 09:00–17:00 only. "typing…" stays on while the AI works (20–60 s per turn with the current model)._

### [x] P2-12 Saran AI settings (client request, 25 Okt 2026)

- Pengaturan → Saran AI: turn suggestions on / off, and choose when they are made (daily, weekly, monthly or only on request).
- _Note: decided 25 Okt 2026: "off" stops all suggestions (no run, no "Minta saran AI", panels say "dimatikan"); Ringkasan konteks and the Telegram strategy chat keep working. Migration 0011 `app_settings` (one row; missing = on, daily 06:30). Schedule rules in `#lib/ai-schedule.ts` (`slotOn`, `dueSlot`, `nextRun`, `scheduleText`, `suggestionTtlDays`; WIB; a short month uses its last day; a missed slot catches up the same day). The `ai-suggestions` task now wakes every 30 minutes and runs only when due (`ai_last_run_at` claims the slot); with Saran AI off it still refreshes the summaries. Open suggestions expire after 7 / 14 / 35 days (daily / weekly / monthly, 14 for manual). The digest's "saran AI baru" line and the suggestions in the Telegram strategy overview are left out while off._

### [ ] P2-13 Executable strategy steps (client request, 27 Okt 2026)

- A plan step is a **reminder** (meeting, call, visit; as before) or a **system action** from a fixed list: **update client profile** (industry, city, website, source, notes + Ringkasan konteks), **create a deal**, **move a deal** (up to Negosiasi; Won / Lost stay manual), **record a payment** on an invoice. "Check payment status" is answered from the data, not an action.
- Once the plan is saved, action steps get **Jalankan** in Telegram and on the web (Strategi, Detail Klien). Jalankan shows a pre-filled preview; nothing is written before Simpan. In Telegram the preview can be corrected by chat (MiniMax), on the web in a form. Simpan runs the existing service and completes the step in one transaction, with an activity.
- For a prospect with a thin profile the AI strongly recommends completing the profile first (the update-profile step comes first), but still gives a strategy.
- The data is checked again when Jalankan is tapped: a deal that already moved or an invoice already paid is refused with a clear message.
- **Done when:** the AI proposes action steps where they fit, update-profile first for a thin prospect; Telegram shows Jalankan on action steps only; each action works from Telegram (preview, a correction, Simpan once, Batal writes nothing) and from the web modal; a stale action is refused; executing completes the step and logs it, and the card keeps an open step; check, lint and tests pass.
- _Status (27 Okt 2026): built, not deployed. Migration 0012 `action.kind` / `action.payload` (applied on dev). The strategy AI writes the action as the last part of a step line (`… | judul | pindah_deal; deal=…; tahap=proposal`); an action on an unknown deal or invoice stays a reminder. A step that is the card's last open step asks for the next one (default "Tindak lanjut …", +2 working days 10:00). The client profile update only writes fields that changed since Jalankan, so a parallel edit is kept; Ringkasan konteks gets the new text appended. Payments go to the "Termin" category (or the first income category) and never above the balance. DB tests cover each action, stale moves and paid invoices, the last-step rule, a double Simpan, and the whole Telegram flow (Jalankan only on actions, a correction by chat, Batal, a message about something else). A real Opus turn through 9router on the dev data (prospect PT Sinar Pangan Indonesia, thin profile) proposed "Lengkapi profil klien" first and three "Pindahkan deal" actions among reminder steps, in 24 s. Open: deploy (migration 0012 on production, Trigger.dev `telegram-inbound`, Vercel), then one real Jalankan per action in Telegram and on the web._

---

## Phase 3 — Productivity

- [ ] **P3-01** Attachments (Cloudflare R2, presigned upload) on client, project, transaction and invoice
- [ ] **P3-02** befisien.com contact form → `POST /api/leads` (secret token) → new client + deal in `lead` with a step "Hubungi lead baru" due today
- [ ] **P3-03** Global search (`pg_trgm`), opened with `Ctrl+K`
- [ ] **P3-04** Export to Excel (transactions, invoices, P&L)
- [ ] **P3-05** Recurring income for maintenance projects (`recurring-income` task)
- [ ] **P3-06** Weekly summary (Monday 08:00 WIB, Telegram + email)
- [ ] **P3-07** WhatsApp channel (Fonnte or WA Cloud API) once Telegram is proven

### [ ] P3-08 Email inbox in the CRM (client request, 27 Okt 2026)

- info@befisien.com moves from Zoho Mail (Forever Free: no IMAP, no forwarding on a custom domain) to **Resend Inbound**: befisien.com's MX points to Resend, Resend posts `email.received` to `POST /api/email` (Svix signature, `RESEND_WEBHOOK_SECRET`), the app fetches the full email and stores it. Zoho no longer receives new mail; its old mail stays readable there.
- Sender matched to a contact (`contact.email`, case-insensitive) → the email is on the client's timeline (activity `email`), so Ringkasan konteks and Saran AI see it. Unmatched mail can be linked to a client by hand.
- **Email** page (`/inbox`; first called Kotak Masuk, renamed because Gmail uses that name for its inbox): threads, filters (Semua / Belum dibaca / Klien / Tanpa klien / Terkirim), unread badge in the sidebar. A thread shows each message (HTML in a sandboxed iframe, remote images off until "Tampilkan gambar"), attachments (fresh Resend download link), "Hubungkan ke klien", "Tandai belum dibaca".
- **Balas / Tulis email** from the CRM through Resend from info@befisien.com, threaded (`In-Reply-To`, `References`, `Re:`), stored as an outgoing message and logged on the client's timeline.
- Every email from the CRM ends with a signature: the sender's name, then company, phone, email, website and city from Pengaturan → Profil perusahaan (example values are left out until the profile is saved). The drawer shows it before sending.
- **Telegram alert** for each new email (not bulk / newsletters) to every linked user: sender, subject, preview, client, link to the thread.
- Not in scope: PRD non-goal "Email inbox inside the app" is lifted for email only; attachments are not copied (Resend keeps them; P3-01 later); sending attachments.
- **Done when:** a test email to the Resend address shows up in Kotak Masuk within a minute, matched to its client, with a Telegram alert; a reply from the CRM arrives threaded in the sender's mail app and appears in the thread and the client timeline; a replayed webhook stores nothing twice; a bad signature is refused; check, lint and tests pass.
- _Status (27 Okt 2026): built, not deployed. Migration 0013 `email_message` + `contact_email_lower_idx` (applied on dev). Tested locally: unsigned / wrongly signed webhooks get 401; DB tests cover matching, a replayed webhook, threading by headers and by `Re:` subject, a reply sent once with the same key, filters, unread, and linking with "simpan sebagai kontak"; in Edge the email script and remote image were blocked (image after "Tampilkan gambar"), the badge cleared on open, and a real reply went out through Resend to delivered@resend.dev. Open, in this order: (1) Resend: check Receiving is enabled on the account and make a full-access API key; (2) production: migration 0013, Vercel env `RESEND_API_KEY` (full access), `RESEND_WEBHOOK_SECRET`, `INBOX_FROM`, deploy; (3) Resend → Webhooks → `https://befisien-crm.vercel.app/api/email`, event `email.received`, copy the signing secret; (4) mail the account's `…@<id>.resend.app` address from Gmail and reply from the CRM; (5) at Rumahweb, add Resend's MX for befisien.com with the lowest priority and remove the three Zoho MX records; check Zoho one last time after 48 hours for mail that arrived during the switch._

## Phase 4 — Later

- [ ] **P4-01** Restricted roles `sales` / `finance` with permission checks per route and action
- [ ] **P4-02** AI drafts follow-up messages (WhatsApp / email) for a step, and summarises a client's history
- [ ] **P4-03** Client portal (read-only invoices and project status)
