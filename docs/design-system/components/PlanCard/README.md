# PlanCard

A strategy plan for one client on the Strategi page: a goal, a target date, progress, and its steps (`bf-step`).

**Consumer provides:** client, goal, the linked deal or project (stage, value), target date, steps (title, `due_at`, assignee, status) and whether it came from an AI suggestion.

- **Step states:** `bf-step--done` (green check, struck title), `--late` (red "!", red time), `--today` (amber ring, amber time) and `--next` (grey ring). Times are mono, "20 Okt 10:00", WIB.
- **Pagination:** max **4 steps** per card. With more, show the small pager `bf-pager--sm` ("Langkah 1–4 dari 6") and open the card on the page holding the **first unfinished step**. Load other step pages on demand.
- The list of plan cards shows max **3 per page**, with the `bf-pager--md` pager under it (see Pager).
- **Footer:** "+ Tambah langkah" opens the inline step form (Langkah baru · Tanggal · **Jam** · PIC · Tambah). "Minta saran AI" is the AI variant.
- Add the `bf-chip--ai` chip "Dibuat dari saran AI" when the plan came from a suggestion.
