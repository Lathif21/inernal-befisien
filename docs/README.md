# Befisien CRM & Keuangan — Project Plan

Internal web app for Befisien Technologies to:

1. Track every client from first contact to finished project on **two kanban boards** (Sales Pipeline and Project Delivery).
2. Plan the work on the **Strategi** screen: a strategy plan per client (goal + dated steps with times), a weekly schedule, and **AI suggestions**.
3. Track **income and costs per client**, so the profit of every client and project is visible.
4. Send a **daily reminder** of late and due steps (Telegram first, plus email), using Trigger.dev.

## Decisions so far

| Topic               | Decision                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Users               | 2 users, both **Admin** (full access). The design allows more roles later.                                                                                                           |
| Boards              | Two kanban boards sharing one client record: **Sales Pipeline** and **Project Delivery**                                                                                             |
| Planning            | **Strategi** screen = strategy plans (goal + steps) **and** a schedule, plus AI suggestions. Late and due-today steps are shown at the top.                                          |
| Steps               | Each step has a **date + time** and a person responsible. A card's "next action" = its earliest open step.                                                                           |
| Dashboard           | **Summary only**: no search and no add buttons. Period filter (Harian / Mingguan / Bulanan / Tahunan / Custom) applies to the whole page. Changes are shown "vs periode sebelumnya". |
| Dashboard chart     | "View by" **Waktu / Klien**. Klien = top 10 clients by income + "Lainnya". Vertical bars in both views.                                                                              |
| Adding data         | Done on the **Klien** page (and the boards and Strategi), not on the Dashboard                                                                                                       |
| Client transactions | Search, the same period filter as the Dashboard, and a Semua / Masuk / Keluar filter                                                                                                 |
| Background jobs     | **Trigger.dev Cloud** (free plan) for reminders, digests and AI suggestions                                                                                                          |
| Reminder channel    | **Telegram bot** first (free, for testing). Email as well. WhatsApp later.                                                                                                           |
| Sending email       | `info@befisien.com` (domain verified in Resend)                                                                                                                                      |
| Invoice number      | `INV/BEF/{YYYY}/{MM}/{seq}` ✔ confirmed                                                                                                                                              |
| Finance scope       | Phase 1: record income and costs, profit per client, dashboard. Phase 2: invoice PDFs (PPN 11% / PPh 23) and overhead costs.                                                         |
| Stack               | **SvelteKit + Neon (Postgres)**, Drizzle ORM, Better Auth, hosted on the Befisien VPS                                                                                                |
| Existing data       | Currently in plain notes. A CSV template and import screen move it in.                                                                                                               |
| Timeline            | Not time-boxed. Work is split into **phases**.                                                                                                                                       |
| Design              | Matches the befisien.com company profile. Design canvas "Befisien CRM".                                                                                                              |
| Language            | Docs in English. UI copy in **Bahasa Indonesia**.                                                                                                                                    |

## Files

| File                                         | What it covers                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-PRD.md`](01-PRD.md)                     | Problem, goals, users, features and acceptance criteria per phase                                                                             |
| [`02-DATA-MODEL.md`](02-DATA-MODEL.md)       | Tables, enums, relations, business rules, Drizzle sketch                                                                                      |
| [`03-SCREENS.md`](03-SCREENS.md)             | Every screen, what it shows, kanban and interaction behaviour                                                                                 |
| [`04-ARCHITECTURE.md`](04-ARCHITECTURE.md)   | Stack, folder structure, auth, Trigger.dev jobs, Telegram, AI, deployment                                                                     |
| [`05-PHASES.md`](05-PHASES.md)               | Phase 0 → 4 backlog, broken into tasks you can hand to Claude Code one at a time                                                              |
| [`06-DESIGN-SYSTEM.md`](06-DESIGN-SYSTEM.md) | Colours, type, components, matching befisien.com                                                                                              |
| [`07-IMPORT-GUIDE.md`](07-IMPORT-GUIDE.md)   | How to turn the current plain notes into the import CSV                                                                                       |
| [`design-system/`](design-system/README.md)  | The Befisien design system for Claude Code: rules, tokens.json, component guidelines and reference CSS (mirror of the Design System artifact) |
| [`CLAUDE.md`](CLAUDE.md)                     | Drop into the repo root: conventions and rules for Claude Code                                                                                |
| [`import-template.csv`](import-template.csv) | CSV template for the first data import                                                                                                        |
| Design canvas "Befisien CRM"                 | Mockups: Dashboard, Pipeline Sales, Won modal, Detail Klien (Keuangan), Strategi. Sample data only.                                           |

## How to use this plan

1. Create the repo and copy `CLAUDE.md` into its root and the other `.md` files into `/docs`.
2. Work through `05-PHASES.md` from top to bottom. Give Claude Code one task at a time, like this: _"Implement P1-04 from docs/05-PHASES.md"_.
3. Tick tasks off in `05-PHASES.md` as they are merged.

## Where things run (answer to "can we use our computer as a server?")

| Part               | Where                             | Why                                                                                                                |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| CRM app            | Befisien VPS (`crm.befisien.com`) | Already paid for, always on, has a public IP and HTTPS                                                             |
| Database           | Neon (cloud)                      | Managed backups                                                                                                    |
| Scheduled jobs     | Trigger.dev Cloud, free plan      | $5/month usage credit and up to 10 schedules. This plan needs about 6 schedules, each running a few seconds a day. |
| During development | **Your own computer**             | `npx trigger.dev dev` runs the tasks on your computer while you build and test                                     |

An office or home computer is **not recommended as the production server**:

- Reminders stop whenever it is off, asleep or offline.
- It usually has no fixed public IP.
- Power and internet cuts take the app down.

If you later want to self-host Trigger.dev (it is open source), the VPS is the better place for it than a PC.

## Open decisions

- **AI provider and model** for suggestions. Recommended: Claude API, with a small model for the daily batch and a larger one for "Minta saran AI" on demand.
- **Phase for AI suggestions:** proposed **Phase 2**, because the AI needs some real history (activities, steps, payments) to give useful advice. Confirm.
- **Telegram in Phase 1:** proposed to ship the Telegram digest in Phase 1, next to email, since it is free and simple. Confirm.
- **Time-based reminders:** steps now have a time, so a reminder could also be sent before a step (e.g. 30 minutes before). Not in the plan yet. Decide whether to add it.
