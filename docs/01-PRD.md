# 01 — Product Requirements

## 1. Problem

Client information, follow-ups and money are spread across plain notes and chat. It is hard to answer four daily questions:

- **Where is each client right now?** (still selling, or already delivering?)
- **What is our plan for each client, and what do we have to do next?**
- **Is anything late?**
- **Are we making money on this client?** (what came in, what went out)

## 2. Goals

| #   | Goal                              | How we know it works                                                                                                        |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| G1  | Every client has a visible status | Every active client appears on exactly one board column                                                                     |
| G2  | Every important client has a plan | Each active deal or project can have a strategy plan: a goal, a target date, and dated steps                                |
| G3  | Nothing falls through the cracks  | Every active card has at least one open step with a date and time. Strategi and the daily digest show anything late or due. |
| G4  | AI helps decide what to do        | The AI suggests next steps, risks and opportunities. A suggestion can be added to a plan in one click.                      |
| G5  | Profit per client is known        | The client page shows income, costs and profit, always up to date                                                           |
| G6  | Period overview                   | The dashboard shows income, costs, profit and pipeline for any period, compared with the previous period                    |
| G7  | Fast to use                       | Adding a client, a step or a transaction takes under 30 seconds                                                             |

## 3. Non-goals (for now)

- Full accounting (general ledger, balance sheet, tax filing)
- WhatsApp inbox inside the app (email moved in with P3-08, client request 27 Okt 2026: info@befisien.com is read and answered in Kotak Masuk)
- Client-facing portal
- Mobile app (the web app is responsive)
- AI acting on its own. The AI only suggests; a person always confirms.

## 4. Users

| User           | Role  | Can do     |
| -------------- | ----- | ---------- |
| User 1 (Aguro) | Admin | Everything |
| User 2         | Admin | Everything |

The database still stores a `role` per user (`admin` | `sales` | `finance`) so restricted roles can be switched on later.

## 5. Core concepts

```
Client (company) ──┬── Contacts (people)
                   ├── Deals ──────── Sales Pipeline board
                   ├── Projects ───── Project Delivery board
                   ├── Strategy plans ── Steps (date + time)
                   ├── Transactions (income / expense)
                   ├── AI suggestions
                   └── Activity log (timeline)
```

- **Client:** the company we sell to.
- **Deal:** a sales opportunity on the **Sales Pipeline**.
- **Project:** the work we deliver after a deal is won, on **Project Delivery**.
- **Strategy plan:** a goal for one client (usually tied to one deal or project), e.g. _"Closing AI Agent pengadaan sebelum 30 Nov"_. It has a target date and an ordered list of steps.
- **Step (action):** one thing to do, with a **date + time**, a person responsible and a status. It belongs to a deal or project, and optionally to a plan. Quick one-off steps don't need a plan.
- **Next action of a card** = the earliest open step of that deal or project. The kanban card shows it.
- **AI suggestion:** a short insight plus a proposed action, generated from the client's history. It can be accepted (it becomes a step or a plan) or dismissed.
- **Transaction:** money in (income) or out (expense), linked to a client and optionally a project.

## 6. Board stages

### Sales Pipeline (`deal_stage`)

| Order | Key           | Label (UI)          | Meaning                                  |
| ----- | ------------- | ------------------- | ---------------------------------------- |
| 1     | `lead`        | Lead                | Known prospect, not contacted yet        |
| 2     | `contacted`   | Dihubungi           | First contact made                       |
| 3     | `meeting`     | Meeting / Discovery | Needs-analysis meeting scheduled or done |
| 4     | `proposal`    | Proposal Terkirim   | Proposal or quotation sent               |
| 5     | `negotiation` | Negosiasi           | Discussing price and scope               |
| 6     | `won`         | Deal ✓              | Signed or confirmed                      |
| 7     | `lost`        | Batal               | Lost. A reason is required.              |

### Project Delivery (`project_stage`)

| Order | Key           | Label (UI)   | Meaning                             |
| ----- | ------------- | ------------ | ----------------------------------- |
| 1     | `onboarding`  | Onboarding   | Kick-off, gathering access and data |
| 2     | `in_progress` | Dikerjakan   | Being built                         |
| 3     | `review`      | Review / UAT | Client is testing                   |
| 4     | `done`        | Selesai      | Handed over                         |
| 5     | `maintenance` | Maintenance  | Ongoing support or retainer         |

**Hand-off rule:** when a deal is moved to `won`, the app asks _"Deal menang! Buat proyek sekarang?"_ If confirmed, it creates a Project in `onboarding` with the deal's value, plus a first step. The client's active plan moves to the new project.

## 7. Features by phase

### Phase 0 — Foundation

- Login (email + password) for the 2 admins. No public sign-up.
- App layout: sidebar, Befisien branding
- Deployed at `crm.befisien.com` with HTTPS

### Phase 1 — MVP: CRM, Strategi, basic finance

**Clients**

- List with search and filter (industry, status, owner). **This is where new clients are added.**
- Create / edit client: name, industry, address, source (website, referral, Apollo, event, other), notes
- Contacts per client: name, position, WhatsApp, email, primary flag
- Click-to-WhatsApp and click-to-email

**Sales Pipeline board**

- Columns = deal stages. Drag cards between and within columns.
- Card shows: client, deal title, value, owner, next action (earliest open step) with date and time, red if late
- Moving to `lost` asks for a reason. Moving to `won` triggers the hand-off.
- Column header shows card count and total value

**Project Delivery board**

- Same behaviour, project stages
- Card shows: client, project name, contract value, payment progress, next action

**Strategi (replaces "Hari Ini")**

- **Perlu perhatian** at the top: late steps and steps due today, which can be ticked off directly
- **Rencana strategi:** list of plans, each with client, goal, linked deal or project, target date, progress (x of y steps done) and its steps
- Add and edit plans and steps. Each step has a title, **date, time** and person responsible.
- **Jadwal:** the steps in the selected period, grouped by day and sorted by time
- Filters: search (client, plan, step), period (Harian / Mingguan / Bulanan / Tahunan / Custom with previous/next), Semua / Saya
- When a step is ticked off, the next step in the plan becomes the card's next action. If the card has no open steps left, the app asks for one (it can be skipped only for `won`, `lost`, `done`).

**Activity log**

- Automatically logs stage changes, completed steps, created transactions and accepted AI suggestions
- Manual notes: call, meeting, WhatsApp, email, note

**Finance (per client)**

- Record a transaction: type (income / expense), date, amount (IDR), category, client, project (optional), description, payment method
- Status: `planned` (expected, e.g. termin 2 next month) or `paid`
- Client page: total income (paid), total expense (paid), profit, planned income
- Client transaction table: **search**, the **same period filter** as the dashboard, and a **Semua / Masuk / Keluar** filter
- Project card and page: contract value vs. income received

**Dashboard (summary only)**

- No search and no add buttons
- **Period filter** for the whole page: Harian, Mingguan, Bulanan, Tahunan, Custom, with previous/next arrows
- KPI tiles: Pemasukan, Pengeluaran, Laba bersih, Nilai pipeline aktif. Each shows the change **vs periode sebelumnya**.
- **Pemasukan vs Pengeluaran** chart with a **View by** dropdown:
  - **Waktu:** vertical bars over time. The bucket follows the period: Harian = last 14 days, Mingguan = last 8 weeks, Bulanan = last 6 months, Tahunan = last 3 years, Custom = auto.
  - **Klien:** vertical bars per client for the selected period. Top 10 by income, the rest combined as "Lainnya".
- Perlu Tindakan (late and due today, with times) linking to Strategi
- Ringkasan Pipeline (current position)
- Klien Teratas by profit in the selected period

**Import**

- CSV upload of clients and contacts (see `07-IMPORT-GUIDE.md`), with a preview before saving

**Daily digest (Trigger.dev)**

- Every day at 07:30 WIB, each user gets a message listing their steps that are late, due today (with times) and due tomorrow
- Channels: **Telegram bot** (Phase 1, proposed) and email from `info@befisien.com`
- Not sent if the user has nothing due

### Phase 2 — AI suggestions, invoices & full finance

**AI suggestions (proposed for this phase)**

- Every morning, Trigger.dev asks the AI to review each active client: recent activity, open steps, stage age, payments
- The AI returns up to 3 suggestions per client, each typed as Risiko (risk), Peluang (opportunity) or Pipeline (housekeeping), with an insight, a proposed action and optionally a date and time
- Shown in **Saran AI** on Strategi, and on the client page
- "Tambahkan ke rencana" turns a suggestion into a step (or a new plan). "Abaikan" dismisses it. Both are logged.
- "Minta saran AI" button on a plan asks for suggestions on demand
- The AI never changes data by itself

**Invoices & finance**

- Invoices: number `INV/BEF/{YYYY}/{MM}/{seq}`, client, project, line items, PPN 11% toggle, PPh 23 (2%) toggle, due date, status (`draft`, `sent`, `partial`, `paid`, `overdue`, `void`)
- Invoice PDF with Befisien branding
- Record a payment against an invoice. This creates an income transaction automatically.
- General company costs (no client): office, salaries, tools
- Monthly profit & loss page: income, direct project costs, overhead, net
- Trigger.dev: mark invoices `overdue` daily, and remind about invoices due in 3 days

### Phase 3 — Productivity

- File attachments (proposals, receipts, contracts) in Cloudflare R2
- befisien.com contact form → creates a new deal in `lead` automatically
- Global search (`Ctrl+K`) across clients, contacts, deals, projects and plans
- Export transactions and invoices to Excel
- Recurring income for maintenance retainers
- Weekly summary (Monday 08:00 WIB)
- WhatsApp as a reminder channel (after Telegram is proven)

### Phase 4 — Later

- Restricted roles (`sales`, `finance`)
- AI drafts follow-up messages (WhatsApp / email) for a step
- Client portal (invoices and project status)

## 8. Acceptance criteria for Phase 1 (summary)

- [ ] Both admins can log in. Anyone else cannot sign up.
- [ ] Clients can be created, edited and archived from the Klien page, with multiple contacts.
- [ ] Deals can be dragged across all 7 stages. The order inside a column is kept after a refresh.
- [ ] Moving a deal to `won` can create a linked project with a first step. Moving it to `lost` requires a reason.
- [ ] Plans and steps can be created with a date and time. Every active card shows its earliest open step. Late ones are red.
- [ ] Strategi shows late and due-today steps at the top, and the schedule follows the period filter and search.
- [ ] The dashboard period filter changes every number on the page. The "vs periode sebelumnya" deltas are correct (checked against seed data).
- [ ] The View by Klien chart shows the top 10 clients plus Lainnya, and the totals equal the Waktu view for the same period.
- [ ] Client transaction search, period and Masuk / Keluar filters work together.
- [ ] CSV import creates clients and contacts and reports skipped rows.
- [ ] The daily digest arrives on Telegram and by email at 07:30 WIB with the correct items. Nothing is sent when nothing is due.
- [ ] Usable on a phone: the boards scroll horizontally and forms stack.

## 9. Formatting rules

- Currency: IDR, no decimals, shown as `Rp 12.500.000`. Short form: `Rp 12,5 jt`.
- Dates: `22 Okt 2026`. Times: 24-hour `14:00`. Timezone: `Asia/Jakarta` (WIB) everywhere.
- Weeks start on **Monday** (Mingguan = Monday to Sunday).
- Phone: stored as `62812…` (no `+`, no leading `0`).
