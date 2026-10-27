# 04 — Architecture

## Stack

| Layer             | Choice                                                                                                                | Why                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Framework         | **SvelteKit** (Svelte 5, runes), TypeScript                                                                           | Your usual stack. Server load functions and form actions cover the whole app.                                               |
| Database          | **Neon Postgres** (region: `aws-ap-southeast-1` Singapore, closest to Indonesia)                                      | Your usual DB. Branching gives a safe dev/staging copy.                                                                     |
| ORM / migrations  | **Drizzle ORM** + `drizzle-kit`                                                                                       | Typed queries, SQL-like, first-class Neon support                                                                           |
| DB driver         | `postgres` (postgres.js) via Drizzle `postgres-js`, using the Neon **pooled** connection string with `prepare: false` | The app runs as a long-lived Node server on the VPS. TCP + pooling supports real transactions, which stage changes need.    |
| Auth              | **Better Auth** (email + password, `disableSignUp: true`) with the Drizzle adapter                                    | Built-in sessions, rate limiting, and an official SvelteKit integration (`npx sv add better-auth`)                          |
| UI                | **Tailwind CSS v4** + **shadcn-svelte** (bits-ui) themed with Befisien tokens                                         | Accessible primitives (drawer, dialog, select, popover), restyled to match befisien.com                                     |
| Kanban DnD        | `svelte-dnd-action`                                                                                                   | Works with Svelte 5, keyboard accessible, touch support                                                                     |
| Ordering          | `fractional-indexing`                                                                                                 | Single-row update per drag                                                                                                  |
| Forms             | **Superforms + Zod**                                                                                                  | Server-validated forms with progressive enhancement                                                                         |
| Charts            | **LayerChart** (used by shadcn-svelte charts)                                                                         | Svelte-native                                                                                                               |
| Background jobs   | **Trigger.dev** (Cloud free plan, v4 SDK `@trigger.dev/sdk`)                                                          | Scheduled tasks with timezone, retries, run logs. Free plan: $5/month usage credit and 10 schedules, which covers this app. |
| Reminders         | **Telegram Bot API** (free)                                                                                           | Plain HTTPS `sendMessage`. No extra library needed.                                                                         |
| Email             | **Resend**, sender `info@befisien.com`                                                                                | Simple API, domain verification for `befisien.com`                                                                          |
| AI (P2)           | LLM API (recommended: Claude API) called from Trigger.dev tasks and one server route                                  | Structured JSON output, validated with Zod before saving                                                                    |
| WhatsApp (P3)     | Fonnte or WhatsApp Cloud API, after Telegram is proven                                                                |                                                                                                                             |
| File storage (P3) | Cloudflare R2 (S3 API)                                                                                                |                                                                                                                             |
| PDF (P2)          | `pdfmake` (server-side, fonts and logo bundled in memory)                                                             | Decided in P2-06: works on Vercel and the VPS without a browser. `src/lib/server/pdf/`.                                     |
| Hosting           | Befisien VPS (Ubuntu 22.04), Docker, Nginx + Certbot, `adapter-node`                                                  | Same server and tooling as the website                                                                                      |
| Dates             | `date-fns` + `@date-fns/tz` with `Asia/Jakarta`                                                                       |                                                                                                                             |

## High-level diagram

```
             Browser (2 admins)
                    │ HTTPS
                    ▼
     Nginx (crm.befisien.com, Certbot TLS)  ── VPS
                    │
                    ▼
     SvelteKit app (adapter-node, Docker) ──── Better Auth (sessions in DB)
                    │ postgres.js (pooled)
                    ▼
              Neon Postgres  ◀──────────────┐
                                            │ same DATABASE_URL
     Trigger.dev Cloud ── scheduled tasks ──┘
          │  daily-digest (07:30 WIB)
          │  ai-suggestions (06:30 WIB, P2), invoice jobs (P2)
          ├──▶ Telegram Bot API  (digest)
          ├──▶ Resend            (digest email, from info@befisien.com)
          └──▶ LLM API           (AI suggestions, P2)

     Telegram ──webhook──▶ /api/telegram  (links a user's chat ID via /start <code>;
                                           queues telegram-inbound for messages and voice
                                           notes; handles the Simpan / Batal buttons)
     telegram-inbound ──▶ Groq Whisper (voice) ──▶ LLM API (draft) ──▶ Telegram (preview)
```

## Repository structure

```
befisien-crm/
├─ CLAUDE.md
├─ docs/                      # the plan files (01–07)
├─ drizzle/                   # generated SQL migrations (committed)
├─ drizzle.config.ts
├─ trigger.config.ts
├─ src/
│  ├─ app.html, app.css, app.d.ts
│  ├─ hooks.server.ts         # Better Auth handler + session → locals, route guard
│  ├─ lib/
│  │  ├─ server/
│  │  │  ├─ db/
│  │  │  │  ├─ client.ts      # createDb(url) — NO $env imports (shared with Trigger.dev)
│  │  │  │  ├─ index.ts       # db = createDb(env.DATABASE_URL) for SvelteKit
│  │  │  │  └─ schema/        # auth.ts, crm.ts, finance.ts, enums.ts, index.ts
│  │  │  ├─ auth.ts           # Better Auth instance
│  │  │  ├─ services/         # business rules: deals.ts, projects.ts, actions.ts, plans.ts, aiSuggestions.ts, transactions.ts, reports.ts
│  │  │  └─ notify/           # telegram.ts, email.ts (digest templates)
│  │  ├─ components/
│  │  │  ├─ ui/               # shadcn-svelte primitives (themed)
│  │  │  ├─ kanban/           # KanbanBoard, KanbanCard, NextActionBox
│  │  │  ├─ strategy/         # PlanCard, StepRow, StepForm, AiSuggestionCard
│  │  │  ├─ PeriodFilter.svelte
│  │  │  ├─ money/            # Money, MoneyInput
│  │  │  └─ layout/           # Sidebar, Topbar, Drawer
│  │  ├─ schemas/             # zod schemas shared by forms + services
│  │  ├─ format.ts            # rupiah(), rupiahShort(), dateID(), phoneNormalize()
│  │  └─ constants.ts         # stage lists, labels, colours
│  ├─ routes/
│  │  ├─ login/
│  │  ├─ (app)/               # authenticated group, +layout.server.ts guards
│  │  │  ├─ +page             # dashboard
│  │  │  ├─ strategy/
│  │  │  ├─ pipeline/
│  │  │  ├─ projects/
│  │  │  ├─ clients/ , clients/[id]/
│  │  │  ├─ finance/
│  │  │  ├─ invoices/         # P2
│  │  │  └─ settings/
│  │  └─ api/                 # telegram webhook (P1), website lead webhook (P3)
│  └─ trigger/                # Trigger.dev tasks
│     ├─ daily-digest.ts
│     └─ …
├─ scripts/
│  ├─ seed.ts                 # 2 admins, categories, demo data (dev only)
│  └─ create-user.ts
├─ Dockerfile
└─ docker-compose.yml
```

### Rule: keep business logic in `services/`

Route actions validate input (Zod) and call a service function. Service functions run inside a DB transaction where needed and write the `activity` log. Trigger.dev tasks call the same services, so the logic is never duplicated.

### Sharing the DB with Trigger.dev

Trigger.dev bundles `src/trigger/*` with its own build, which **does not understand SvelteKit's `$lib` or `$env`**. So:

- `src/lib/server/db/client.ts` exports `createDb(url: string)` and imports the schema with **relative paths** only.
- Tasks do `const db = createDb(process.env.DATABASE_URL!)`.
- Set `DATABASE_URL` and `RESEND_API_KEY` in the Trigger.dev dashboard environment variables.

## Auth

- `npx sv add better-auth` (Drizzle adapter), then set `emailAndPassword: { enabled: true, disableSignUp: true }`.
- Users are created with `scripts/create-user.ts` (Phase 0) or from Settings → Pengguna (admin only).
- `hooks.server.ts`: resolve the session into `event.locals.user`. Any route under `(app)` redirects to `/login` if there is no session.
- Roles: `locals.user.role`. Phase 1 has only `admin`, but helpers `requireRole('admin')` exist from day one.

## Trigger.dev tasks

```ts
// src/trigger/daily-digest.ts
import { schedules, logger } from '@trigger.dev/sdk';
import { createDb } from '../lib/server/db/client';
import { getDigestItems } from '../lib/server/services/actions';
import { sendDigestEmail } from '../lib/server/notify/email';
import { sendTelegramDigest } from '../lib/server/notify/telegram';

export const dailyDigest = schedules.task({
	id: 'daily-digest',
	cron: { pattern: '30 7 * * *', timezone: 'Asia/Jakarta' },
	run: async () => {
		const db = createDb(process.env.DATABASE_URL!);
		const users = await db.query.user.findMany({ where: (u, { eq }) => eq(u.digestEnabled, true) });
		for (const u of users) {
			const items = await getDigestItems(db, u.id); // late, today (with times), tomorrow
			if (items.total === 0) {
				logger.info('nothing due', { user: u.email });
				continue;
			}
			if (u.telegramChatId && u.digestChannels.includes('telegram'))
				await sendTelegramDigest(u.telegramChatId, items);
			if (u.digestChannels.includes('email')) await sendDigestEmail(u, items);
		}
	}
});
```

```ts
// src/lib/server/notify/telegram.ts — no SDK needed
export async function sendTelegram(chatId: string, text: string) {
	const res = await fetch(
		`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				parse_mode: 'HTML',
				disable_web_page_preview: true
			})
		}
	);
	if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`); // Trigger.dev retries
}
```

**Linking Telegram:** Settings → "Hubungkan Telegram" creates a one-time code. The user opens `t.me/<bot>?start=<code>`. Telegram calls the webhook `POST /api/telegram` (verified with the `X-Telegram-Bot-Api-Secret-Token` header). The route matches the code and saves `user.telegram_chat_id`.

**Telegram input (P2-10):** a linked user sends a message or a voice note. The webhook queues the task `telegram-inbound` (idempotency key = the update ID, so Telegram's retries do not run it twice) and answers with a typing indicator. The task transcribes voice notes with Groq Whisper (`whisper-large-v3`, Indonesian), gives the LLM the message plus a short list of clients, open deals and running projects (refs K1 / D1 / P1 instead of UUIDs), and checks the answer: a lead goes through the CSV import checks (`validateRow`), steps need a card and a WIB time, a lost deal needs a reason. It stores a `telegram_draft` and replies with a preview and the buttons **Simpan** / **Batal**. Simpan (in the webhook, one DB transaction) writes through the normal services and marks the draft saved, so a second tap does nothing. Drafts expire after 30 minutes. A message sent while a draft is open may correct it; the old draft becomes `replaced`. Register the webhook with `npm run telegram:webhook -- --url <app>` (`allowed_updates`: `message`, `callback_query`).

| Task                              | Schedule (WIB)                                                               | Phase |
| --------------------------------- | ---------------------------------------------------------------------------- | ----- |
| `daily-digest` (Telegram + email) | every day 07:30                                                              | 1     |
| `ai-suggestions`                  | every day 06:30 (before the digest, so new suggestions can be counted in it) | 2     |
| `ai-suggest-now`                  | triggered by "Minta saran AI" (not scheduled)                                | 2     |
| `ai-expire-suggestions`           | every day 00:30                                                              | 2     |
| `telegram-inbound`                | queued by the Telegram webhook for each message or voice note                | 2     |
| `invoice-mark-overdue`            | every day 00:15                                                              | 2     |
| `invoice-due-reminder`            | every day 08:00 (due in 3 days)                                              | 2     |
| `recurring-income`                | 1st of month 01:00                                                           | 3     |
| `weekly-summary`                  | Monday 08:00                                                                 | 3     |

That is 7 schedules at most, within the free plan's 10.

### AI suggestions (Phase 2)

- **Input per client** (kept small): stage and days in stage, value, the last 10 activities, open and late steps, plan goal and progress, paid vs. contract amount
- **Output:** JSON validated with Zod: `[{ kind: 'risk'|'opportunity'|'pipeline', insight, proposed_action, proposed_due_at? }]`, max 3
- Skip the call when `input_hash` matches the last run (nothing changed), to save cost
- The prompt states the rules: suggestions only, Bahasa Indonesia, concrete and dated, no invented facts
- Nothing is written to deals, plans or steps until a person clicks "Tambahkan ke rencana"
- Log the model ID with each suggestion
- **Ringkasan konteks (long memory):** before the suggestions, the same daily run rewrites each client's `client_context` from the previous summary plus the whole history (every deal with its outcome and lost reason, the newest 200 timeline entries, projects, contacts, payments), only when that history changed. The team can edit it on the client page; the AI's next update starts from their text. Suggestions read it as `ringkasan_konteks`.

Development: `npx trigger.dev@latest dev`. Deploy: `npx trigger.dev@latest deploy`, which syncs the declarative cron schedules.

### Kotak Masuk (P3-08)

befisien.com's MX points to **Resend Inbound** (Zoho Mail Free has no IMAP and no forwarding for a custom domain). For each received email Resend posts `email.received` to `POST /api/email`:

1. Check the Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`; HMAC-SHA256 with `RESEND_WEBHOOK_SECRET`, 5 minutes tolerance). Wrong = 401.
2. Fetch the full email (`GET /emails/receiving/{id}`, inline images as data URIs; needs a full-access `RESEND_API_KEY`).
3. `receiveEmail`: store once (Resend id, then Message-ID), thread it, match the client, log the activity, all in one transaction.
4. Telegram alert to every linked user, unless it is bulk mail. Errors here are logged, never retried.

Any other error answers 500 and Resend retries; a repeat stores nothing. Replies go out through the Resend send API from `INBOX_FROM`, with `In-Reply-To` / `References` and an `Idempotency-Key` from the form. Email HTML is shown only in a sandboxed iframe (no scripts, its own CSP, remote images off until "Tampilkan gambar").

**Big files (up to 200 MB):** Vercel accepts 4.5 MB per request and Resend 40 MB per email, so files never pass through the app. The drawer asks the `upload` action for a presigned PUT and the browser uploads to the Neon bucket `email-files` (private, CORS for the app's origin). On send, the server checks each object, attaches files while they fit in 25 MB together, and puts the rest in the email as links to `/f/<token>`, a public route that checks the expiry (30 days) and redirects to a one-hour presigned GET. The `email-files-cleanup` task deletes expired files every night.

Writing in the CRM uses a rich-text editor (Tiptap). Pictures pasted or dropped into the text are shrunk in the browser and posted as base64 inside the HTML; the server cleans the HTML (sanitize-html, only the editor's tags), sends each picture as an inline attachment (`cid:`) and stores the `data:` version, so the thread keeps showing it. Files go to Resend as attachments and are not copied: Resend keeps them 30 days, the thread fetches a fresh link until then. Files and pictures together are limited to 4 MiB per email, under Vercel's 4.5 MB request limit; adapter-node accepts only 512 kB by default, so the VPS needs `BODY_SIZE_LIMIT`.

## Environment variables

```
DATABASE_URL=postgres://…-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgres://…ap-southeast-1.aws.neon.tech/neondb?sslmode=require   # drizzle-kit migrations
BETTER_AUTH_SECRET=…
BETTER_AUTH_URL=https://crm.befisien.com
ORIGIN=https://crm.befisien.com          # adapter-node
BODY_SIZE_LIMIT=6M                       # adapter-node: email attachments + pictures (default 512K)
RESEND_API_KEY=…
MAIL_FROM="Befisien CRM <info@befisien.com>"
RESEND_WEBHOOK_SECRET=whsec_…              # Kotak Masuk: Resend webhook email.received → /api/email
INBOX_FROM="Befisien <info@befisien.com>"   # sender of emails written in the CRM
NEON_STORAGE_ACCESS_KEY_ID=…                # big email files: Neon bucket email-files (AWS_* of the branch)
NEON_STORAGE_SECRET_ACCESS_KEY=…
NEON_STORAGE_ENDPOINT=https://br-….storage….aws.neon.tech
NEON_STORAGE_REGION=us-east-2
TELEGRAM_BOT_TOKEN=…                     # from @BotFather
TELEGRAM_WEBHOOK_SECRET=…
TRIGGER_SECRET_KEY=…                     # the webhook queues "telegram-inbound"
AI_API_KEY=…                             # Phase 2
GROQ_API_KEY=…                           # Trigger.dev only: voice-note transcripts (P2-10)
TZ=Asia/Jakarta
```

## Environments

| Env        | DB                | App                                                                                         |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------- |
| Local dev  | Neon branch `dev` | `npm run dev`. `npx trigger.dev dev` runs the tasks **on your own computer** while testing. |
| Production | Neon `main`       | VPS Docker at `crm.befisien.com`                                                            |

Neon branches make it safe to test migrations: branch from `main`, run `drizzle-kit migrate`, check, then run on `main`.

## Deployment (VPS)

1. DNS: `A crm.befisien.com → VPS IP`
2. `docker compose up -d --build` (Node 22 alpine image, `node build`, port 3000, `restart: unless-stopped`)
3. Nginx server block proxying to `127.0.0.1:3000`, then `certbot --nginx -d crm.befisien.com`
4. Migrations: `npm run db:migrate` (uses `DATABASE_URL_UNPOOLED`) before restarting the container
5. Optional later: a GitHub Action that SSHes in, pulls, migrates and rebuilds

## Security checklist

- No public sign-up. Better Auth rate limiting is on.
- All `(app)` routes are guarded in `+layout.server.ts`, **and** every form action checks `locals.user` (defence in depth).
- Validate all input with Zod on the server. Never trust amounts or totals from the client.
- Security headers in Nginx (HSTS, X-Frame-Options DENY, a sensible CSP).
- Secrets only in `.env` on the server and in the Trigger.dev dashboard. Never commit them.
- Backups: Neon point-in-time restore (check the restore window on your plan) **plus** a weekly `pg_dump` from a VPS cron to a separate location.
