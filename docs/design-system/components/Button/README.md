# Button

Every action in the app and on the website. Verb-first, sentence case, Bahasa Indonesia.

**Consumer provides:** the label (and an optional Lucide icon placed before it), the variant, and an `aria-label` when the button is icon-only.

| Variant          | Class                               | Use                                                                                               |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Primary          | `bf-btn--primary`                   | The one main action of a view ("Buat Proyek", "Simpan · 25 Okt"). Max one per view.               |
| Secondary        | `bf-btn--secondary`                 | The alternative next to a primary ("Nanti saja", "Edit", "+ Tambah langkah").                     |
| Dark             | `bf-btn--dark`                      | Strong action on a white panel that must not compete with accent (website finder "Lihat Solusi"). |
| Ghost            | `bf-btn--ghost`                     | Inline links in card headers ("Lihat semua", "Buka board").                                       |
| Income / Expense | `bf-btn--income`, `bf-btn--expense` | "+ Pemasukan" / "+ Pengeluaran" pair on finance views only.                                       |
| AI               | `bf-btn--ai`, `bf-btn--ai-solid`    | AI actions only ("Minta saran AI", "Tambahkan ke rencana").                                       |
| Pill             | add `bf-btn--pill`                  | Website CTAs and the top-bar "Konsultasi Gratis".                                                 |

- Height is `size-touch` (44px). Use `bf-btn--sm` (36px) only inside cards on desktop.
- Do not put two primaries side by side, and do not use the AI variants for non-AI actions.
- Disabled buttons use the `disabled` attribute, never only a grey colour.
