# 06 — Design System

> **Source of truth:** `docs/design-system/` (README.md = rules, tokens.json = every value, components/*/README.md = per-component guidelines, components/bundle.css = reference markup and states). It mirrors the "Befisien" Design System artifact. If this page and `design-system/` disagree, `design-system/` wins.

Matches the **befisien.com** company profile: confident blue, deep navy, white space, rounded cards and the 3D illustrations. The CRM is a work tool, so it uses the same palette with **denser spacing** and **smaller headings** than the website.

## Colour tokens

| Token               | Hex       | Use                                                             |
| ------------------- | --------- | --------------------------------------------------------------- |
| `--accent`          | `#1F5BEA` | Primary buttons, active nav, links, focus, primary chart series |
| `--accent-hover`    | `#163BA6` | Hover / pressed                                                 |
| `--navy`            | `#0B1840` | Text, sidebar background, dark surfaces                         |
| `--navy-2`          | `#16285E` | Sidebar hover / active row on navy                              |
| `--sky`             | `#9FD4FF` | Highlight text on blue or navy                                  |
| `--tint`            | `#DDE8FF` | Selected rows, chips, kanban column background                  |
| `--tint-2`          | `#EEF3FF` | Page background behind cards                                    |
| `--surface`         | `#FFFFFF` | Cards, drawers, tables                                          |
| `--line`            | `#DCE4F5` | Borders, dividers                                               |
| `--text`            | `#0B1840` | Body text                                                       |
| `--text-2`          | `#3E4C75` | Secondary text (meets 4.5:1 on white and tint)                  |
| `--text-3`          | `#5E6A8E` | Captions, meta (on white only)                                  |
| `--success`         | `#0E6B47` | Income, paid, Deal ✓ (text)                                     |
| `--success-fill`    | `#13865A` | Solid marks: done icon, WhatsApp button                         |
| `--success-bg`      | `#DDF5EA` |                                                                 |
| `--danger`          | `#A12822` | Expense, overdue, Batal (text)                                  |
| `--danger-fill`     | `#C8322B` | Solid marks: late icon, badge                                   |
| `--danger-bg`       | `#FDE3E1` |                                                                 |
| `--warning`         | `#9A5B00` | Due today (text)                                                |
| `--warning-bg`      | `#FFEFC7` |                                                                 |
| `--warning-fill`    | `#E0A100` | Today ring, Hari ini card border (not text)                     |
| `--accent-ink`      | `#1F4FD6` | Blue text on tint / tint-2                                      |
| `--line-strong`     | `#7A90C4` | Meaningful borders and rings (3.2:1)                            |
| `--on-accent-muted` | `#E3EBFF` | Secondary text on accent                                        |
| `--ai`              | `#5B2DB8` | AI labels, AI buttons (used **only** for AI content)            |
| `--ai-bg`           | `#F7F2FF` | Saran AI cards                                                  |
| `--ai-line`         | `#D9C9FF` | Saran AI section border                                         |

Income vs. expense is never shown by colour alone. Always use a `+` / `−` sign or an "Masuk" / "Keluar" label as well.

### Stage chip colours

| Stage     | Background / text     |
| --------- | --------------------- |
| Lead      | `#EEF3FF` / `#3E4C75` |
| Dihubungi | `#DDE8FF` / `#1F4FD6` |
| Meeting   | `#CFE0FF` / `#163BA6` |
| Proposal  | `#1F5BEA` / `#FFFFFF` |
| Negosiasi | `#0B1840` / `#FFFFFF` |
| Deal ✓    | `#DDF5EA` / `#0E6B47` |
| Batal     | `#FDE3E1` / `#A12822` |

The blue deepens as a deal gets closer to closing, so the board reads left to right at a glance.

### Chart palette

Income `#1F5BEA` · Expense `#0B1840` · Planned `#9FD4FF` (hatched) · Profit line `#13865A`

## Typography

- **Font:** Plus Jakarta Sans (400, 500, 600, 700, 800), the same as befisien.com. Numbers use `font-variant-numeric: tabular-nums`.
- **Mono:** JetBrains Mono 500 for IDs, invoice numbers and stage counters.

| Style         | Size / weight / line height             |
| ------------- | --------------------------------------- |
| Page title    | 28 / 800 / 1.15, letter-spacing −0.02em |
| Section title | 18 / 700                                |
| KPI value     | 26 / 800, tabular                       |
| Body          | 14 / 500 / 1.5                          |
| Small / meta  | 12.5 / 600                              |
| Card title    | 14.5 / 700                              |

## Shape & spacing

- Radius: cards **18px**, kanban cards **14px**, inputs and buttons **12px**, chips and pills **999px**. The website uses 26–36px. The app is a bit tighter.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32
- Shadow (cards on hover, drawers): `0 18px 36px -22px rgba(11,24,64,.45)`
- Touch targets ≥ 44px

## Layout

- **Sidebar:** 240px, **navy** background, white text, active item = blue pill. Logo at the top (same B mark + wordmark as the website). Collapses to 72px icons. Bottom tab bar on phones.
- **Page header:** white, page title, period filter where relevant, page actions, avatar. No global search or add bar.
- **Content:** `--tint-2` background, cards on white.
- **Kanban column:** 288px wide, `--tint` background, 16px radius, header sticky inside the column.

## Components (visual rules)

- **Primary button:** accent background, white text, 12px radius, 40px height (44px on touch)
- **Secondary button:** white background, `--line` border, navy text
- **Ghost button:** text only, accent colour
- **StatTile:** white card. Label (12.5/600, `--text-2`), value (26/800), delta chip (green ▲ / red ▼ with the % number)
- **Kanban card:** white, 1px `--line` border, 14px radius, 12px padding. On hover: lift + shadow. While dragging: rotate 2° with an accent outline.
- **NextActionBox:** inside the card footer, 10px radius
  - upcoming: `--tint-2` background, `--text-2` text, calendar icon
  - today: `--warning-bg` / `--warning`
  - overdue: `--danger-bg` / `--danger`, "Terlambat x hari"
  - none: dashed `--line` border, "+ Tambah langkah berikutnya"
- **Avatar:** initials, 28px circle, accent background, white 12/700
- **Money:** `Rp` prefix in `--text-2`, number in `--text`. Income has a green `+` and expense a red `−` in tables.

## Illustrations

Re-use the 3D renders from befisien.com (`static/illustrations/*.webp`):

| Image              | Used for                   |
| ------------------ | -------------------------- |
| `hero.webp`        | Login page                 |
| `agent.webp`       | Empty Klien                |
| `dashboard.webp`   | Empty Keuangan / Dashboard |
| `automation.webp`  | "Semua beres" on Strategi  |
| `integration.webp` | Empty Rencana on Strategi  |
| `integration.webp` | Import Data page           |
| `finance.webp`     | Empty Invoice (P2)         |

## Icons

**Lucide** (`@lucide/svelte`), 1.75 stroke, 18px in nav, 16px inline. No emoji in the UI.

## Tailwind v4 theme snippet

```css
/* src/app.css */
@import 'tailwindcss';
@theme {
	--font-sans: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
	--font-mono: 'JetBrains Mono', ui-monospace, monospace;
	--color-accent: #1f5bea;
	--color-accent-hover: #163ba6;
	--color-navy: #0b1840;
	--color-navy-2: #16285e;
	--color-sky: #9fd4ff;
	--color-tint: #dde8ff;
	--color-tint-2: #eef3ff;
	--color-line: #dce4f5;
	--color-ink-2: #3e4c75;
	--color-ink-3: #5e6a8e;
	--color-success: #0e6b47;
	--color-success-fill: #13865a;
	--color-success-bg: #ddf5ea;
	--color-danger: #a12822;
	--color-danger-fill: #c8322b;
	--color-danger-bg: #fde3e1;
	--color-warning-fill: #e0a100;
	--color-accent-ink: #1f4fd6;
	--color-line-strong: #7a90c4;
	--color-on-accent-muted: #e3ebff;
	--color-warning: #9a5b00;
	--color-warning-bg: #ffefc7;
	--color-ai: #5b2db8;
	--color-ai-bg: #f7f2ff;
	--color-ai-line: #d9c9ff;
	--radius-card: 18px;
	--radius-kanban: 14px;
	--radius-control: 12px;
}
```
