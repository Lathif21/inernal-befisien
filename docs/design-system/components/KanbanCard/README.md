# KanbanCard

One deal (Pipeline Sales) or project (Proyek) on a board, inside a `bf-kcol` column.

**Consumer provides:** client name, service type, title, value (`rupiahShort`), the next action (see NextActionBox), the owner initials and days in stage. Project cards add a payment progress bar (`bf-progress`, "Rp 96 jt / 120 jt") and the target end date.

- **Column header:** stage dot (`stage-*` token), stage name, count (mono) and total value. Deal ✓ and Batal columns are collapsed to 92px and show the last 30 days only.
- **Card order, top to bottom:** client + service chip, title, value, next action, footer (avatar, "x hari di tahap ini", "⋯" menu with "Pindah ke…").
- **Drag:** hover lifts the card with `shadow-raised`. While dragging, add `bf-kcard--dragging`.
  - Dropping on Batal asks for a reason.
  - Dropping on Deal ✓ opens "Deal menang! Buat proyek sekarang?".
- **Keyboard and touch:** the "⋯" menu offers "Pindah ke…", the required alternative to drag.
- Clicking the card opens the right-side drawer, not a new page.
