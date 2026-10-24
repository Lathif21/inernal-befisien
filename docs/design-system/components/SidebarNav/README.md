# SidebarNav

The app's main navigation: a navy column (240px, or a 72px icon rail chosen with the "Ciutkan menu" / "Perluas menu" toggle at the bottom; tablets default to the rail). On phones it is a left drawer opened from the menu button in the Topbar, with the account and Keluar at the bottom.

**Consumer provides:** the current route and the late + due-today count for the Strategi badge.

- **Logo block:** the B mark (28×34) with "BEFISIEN" over "CRM & KEUANGAN" in `sky`.
- **Items, in order:** Dashboard · Strategi · Pipeline Sales · Proyek · Klien · Keuangan · Invoice (Phase 2, muted with a "Fase 2" chip) · Pengaturan at the bottom.
- **Active item:** `accent` pill with `aria-current="page"`. Inactive items use `on-dark-link`, with `navy-2` on hover.
- **Badge:** `danger-fill` with a white number. On the active pill, invert it to white with `danger` text.
- Each item has an 18px Lucide icon (stroke 1.75) before the label.
