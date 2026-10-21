# 03 — Screens & Interaction

UI language: **Bahasa Indonesia**. Labels below are the actual UI copy.
Layout: left navy sidebar (becomes a bottom bar on phones) and a page header. There is **no global search or "+ Tambah" bar**. Each page has its own header and actions, and the Dashboard is summary-only.

## Navigation

| Sidebar item   | Route       | Phase           |
| -------------- | ----------- | --------------- |
| Dashboard      | `/`         | 1               |
| Strategi       | `/strategy` | 1 (Saran AI: 2) |
| Pipeline Sales | `/pipeline` | 1               |
| Proyek         | `/projects` | 1               |
| Klien          | `/clients`  | 1               |
| Keuangan       | `/finance`  | 1               |
| Invoice        | `/invoices` | 2               |
| Pengaturan     | `/settings` | 1               |

The Strategi item shows a red badge with the number of late + due-today steps for the logged-in user.

## Shared: period filter

Used on Dashboard, Strategi, the client transaction table, and Keuangan. It looks and behaves the same everywhere:

- Segmented control: **Harian · Mingguan · Bulanan · Tahunan · Custom**
- Previous / next arrows and the period label (e.g. `1 – 31 Okt 2026`, `19 – 25 Okt 2026`)
- Custom opens a date-range picker
- Weeks run Monday–Sunday. All dates are in WIB.
- The selected period is kept in the URL (`?period=month&from=2026-10-01`), so a refresh or a shared link keeps it

---

## 1. Login — `/login`

- Befisien logo, email, password, "Masuk"
- Split layout: form left, blue panel with the 3D hero illustration right
- No sign-up link

## 2. Dashboard — `/` (summary only)

1. **Header:** title "Dashboard", period label, **period filter**, prev/next, avatar. No search, no add button.
2. **Greeting bar:** "Selamat pagi, Aguro", the date, how many steps are late or due today, and a "Buka Strategi" button.
3. **KPI tiles** (all follow the period): Pemasukan · Pengeluaran · Laba bersih · Nilai pipeline aktif. Each has a delta chip **"▲ x% vs periode sebelumnya"** (green = good, red = bad. For Pengeluaran, an increase is red.)
4. **Pemasukan vs Pengeluaran** chart with a **View by** dropdown:
   - **Waktu:** vertical grouped bars per time bucket. Bucket by period: Harian → last 14 days, Mingguan → last 8 weeks, Bulanan → last 6 months, Tahunan → last 3 years, Custom → auto (≤ 31 days = days, ≤ 6 months = weeks, otherwise months).
   - **Klien:** vertical grouped bars per client for the selected period. Top 10 by income, then "Lainnya". Labels are short names (without "PT"/"CV"), max 2 lines. Full name and amounts appear in the tooltip.
   - Subtitle explains what is shown, e.g. "Okt 2026 · 10 klien teratas menurut pemasukan + lainnya"
5. **Perlu Tindakan:** late (red) then today (amber, with time), max 6, link "Buka Strategi"
6. **Ringkasan Pipeline:** current position (not period-based, labelled "Posisi saat ini")
7. **Klien Teratas:** top 5 by profit in the selected period

## 3. Strategi — `/strategy`

Where the team plans. It replaces "Hari Ini".

**Header**

- Title, summary line ("3 rencana aktif · 9 langkah minggu ini · 3 saran AI baru"), "+ Rencana" button
- Filter row: **search** (client, plan goal, step title), **period filter** (default Mingguan), prev/next with label, **Semua / Saya**

**Perlu perhatian** (always at the top, ignores the period filter)

- Two cards side by side: **Terlambat** (red top border) and **Hari ini** (amber)
- Each row: checkbox, step title, client, date + time (late shows "x hari")
- Ticking a step completes it. The next step of its plan becomes the card's next action. If no open step is left, a small popover asks **"Langkah berikutnya?"** (title, date, time with quick buttons Besok / +3 hari / +1 minggu / Pilih tanggal, and an optional "Pindahkan deal ke [next stage]" checkbox).

**Rencana strategi** (main column)

- One card per active plan, sorted by nearest target date
- Card header: client, **goal**, chips (linked deal or project with stage and value, "Target 30 Nov", "Dibuat dari saran AI" if relevant), progress "2 dari 5 langkah selesai" with a bar
- Ordered step list. Each step shows a status icon (done ✓ green, late ! red, today amber ring, upcoming grey ring), title, **date + time**, assignee avatar.
- **Pagination (to keep the page fast):**
  - **Max 3 plans per page.** A pager under the list reads "Menampilkan rencana 1–3 dari 5" with Sebelumnya, page numbers and Berikutnya. The page is kept in the URL (`?plans=2`).
  - **Max 4 steps per plan card.** When a plan has more, the card shows a small pager ("Langkah 1–4 dari 6" with ‹ 1 2 ›). The card opens on the page that holds the **first unfinished step**, so the next thing to do is always visible.
  - Steps on other pages are fetched only when that page is opened.
- Inline **add step** form: Langkah baru · Tanggal · **Jam** · PIC · Tambah
- Buttons: "+ Tambah langkah", "Minta saran AI" (Phase 2)
- Plan menu: edit goal or target, mark achieved, drop

**Saran AI** (right column, Phase 2)

- Header with the 3D agent illustration: "Dibuat tiap pagi dari riwayat klien · 07:30"
- Suggestion cards, each with a type label (Risiko / Peluang / Pipeline), the insight (bold), the proposed action, and the buttons **"Tambahkan ke rencana"** (or "Buat langkah") and **"Abaikan"**
- Footer: "Saran AI bisa keliru. Periksa dulu sebelum dipakai."
- Visual: purple AI accent (see design system), so AI content is never confused with data the team entered

**Jadwal** (right column)

- Steps in the selected period, grouped by day ("KAMIS, 22 OKT · HARI INI"), sorted by time. Done steps are struck through.

**Phone:** columns stack in this order: Perlu perhatian → Saran AI → Rencana → Jadwal.

## 4. Pipeline Sales — `/pipeline`

- **Header:** title, total open value, **Sales / Proyek** toggle, filters (search, owner, service type, a red "x terlambat" quick filter), "+ Deal"
- **Columns:** Lead · Dihubungi · Meeting / Discovery · Proposal Terkirim · Negosiasi · Deal ✓ · Batal
  - Header: name, count, total value
  - `Deal ✓` and `Batal` are collapsed (last 30 days only)
- **Card:** client + service chip · deal title · value · **next action box** (earliest open step with date + time: red late / amber today / grey upcoming / dashed "+ Tambah langkah berikutnya" if none) · owner avatar · "x hari di tahap ini" · "⋯" menu (Pindah ke…)
- **Drag & drop:** `svelte-dnd-action`, optimistic update with rollback
  - Drop on **Batal** → reason modal (Harga, Timing, Pilih kompetitor, Tidak ada budget, Tidak responsif, Lainnya + text)
  - Drop on **Deal ✓** → modal "Deal menang! Buat proyek sekarang?" with name, contract value, start date and the project's first step (default "Kick-off meeting", +3 days 10:00) → "Buat Proyek" / "Nanti saja"
- **Click a card** → right drawer: details, plan (if any) with steps, activity timeline, link to client
- **Phone:** horizontal scroll with snap. "Pindah ke…" menu instead of drag.

## 5. Proyek — `/projects`

Same pattern. Columns: Onboarding · Dikerjakan · Review / UAT · Selesai · Maintenance. The card adds a payment progress bar (`Rp 96 jt / 120 jt`) and the target end date.

## 6. Klien — `/clients`

- **This is where clients are added** ("+ Klien" drawer)
- Table: name, industry, status, primary contact (WA icon), open deals, active projects, profit YTD, owner
- Search, filters (status, industry), sort

## 7. Detail Klien — `/clients/[id]`

- **Header card:** name, status, industry, city, source, owner, primary contact with WhatsApp and email buttons, Edit
- **Finance strip:** Total Pemasukan · Total Pengeluaran · Laba (with margin) · Pemasukan Direncanakan
- **Tabs:** Ringkasan · Kontak · Deal & Proyek · **Keuangan** · Aktivitas · (Strategi: the client's plans, also reachable here) · File (P3)
- **Keuangan tab:**
  - "+ Pemasukan" / "+ Pengeluaran"
  - Filters: **search** (description, category), **Semua / Masuk / Keluar**, **period filter** (default Tahunan), "Menampilkan x dari y transaksi"
  - Table: Tanggal · Keterangan · Kategori · Status (Dibayar / Direncanakan) · Jumlah (green "+", red "−")
  - Empty result: "Tidak ada transaksi yang cocok dengan filter."
- **Right column:** active project card (payment progress, next action) and latest activity

## 8. Keuangan — `/finance`

- Period filter, KPI tiles (Pemasukan, Pengeluaran, Laba, Direncanakan)
- Transactions table with search and filters (type, category, client, status)
- "+ Transaksi" drawer: Pemasukan / Pengeluaran toggle, amount with live formatting, date, client, project, category, method, description, status
- Phase 2: "Laba Rugi" tab, overhead costs

## 9. Invoice (Phase 2) — `/invoices`

List with status chips. Editor with items, PPN / PPh 23 toggles, live totals, "Unduh PDF", "Tandai Terkirim", "Catat Pembayaran".

## 10. Pengaturan — `/settings`

- **Pengguna:** add user, reset password, digest on/off, channels (Telegram / email)
- **Telegram:** "Hubungkan Telegram" shows a one-time code and a link `t.me/<bot>?start=<code>`. The bot stores the chat ID.
- **Kategori:** income and expense categories
- **Import Data:** CSV upload → preview → import
- **AI (P2):** on/off, time of the daily run

---

## Shared components

| Component                                                    | Notes                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PeriodFilter`                                               | Segmented control + prev/next + custom picker. Writes to the URL.                                                                                                                      |
| `KanbanBoard`, `KanbanCard`                                  | Generic, `onMove(cardId, toStage, beforeId, afterId)`                                                                                                                                  |
| `NextActionBox`                                              | none / upcoming / today / late, shows date + time                                                                                                                                      |
| `PlanCard`, `StepRow`, `StepForm`                            | Strategi building blocks (StepForm includes a time input)                                                                                                                              |
| `Pager`                                                      | Two sizes: `sm` (inside a card, 32px buttons, "Langkah x–y dari z") and `md` (under a list, 40px, with Sebelumnya / Berikutnya). Current page is navy, disabled arrows are greyed out. |
| `AiSuggestionCard`                                           | Type label, insight, action, accept / dismiss                                                                                                                                          |
| `GroupedBarChart`                                            | LayerChart, vertical, 2 series, label clamp, tooltip                                                                                                                                   |
| `MoneyInput`, `Money`                                        | IDR input and display (`full` / `short`)                                                                                                                                               |
| `Drawer`, `StatTile`, `Avatar`, chips, `EmptyState`, `Toast` |                                                                                                                                                                                        |

## Empty states (3D illustrations from befisien.com)

- No clients → `agent.webp`, "Belum ada klien. Tambah klien pertama atau import dari catatan."
- No plans → `integration.webp`, "Belum ada rencana. Buat rencana untuk klien prioritas."
- Nothing late or due → `automation.webp`, "Semua beres! Tidak ada yang terlambat."
- No transactions in period → `dashboard.webp`, "Belum ada transaksi di periode ini."
