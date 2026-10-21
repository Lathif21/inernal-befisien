# NextActionBox

Shows a card's next action: the earliest open step of a deal or project. It sits in the footer area of every kanban card and in project mini-cards.

**Consumer provides:** the step title, `due_at` and the current time. The component works out the state in WIB.

| State      | When            | Look                                                                     |
| ---------- | --------------- | ------------------------------------------------------------------------ |
| `late`     | `due_at` < now  | `danger-bg`, alert icon, "Terlambat x hari" (or "x jam" on the same day) |
| `today`    | due later today | `warning-bg`, clock icon, "Hari ini 14:00"                               |
| `upcoming` | due after today | `tint-2`, calendar icon, "Besok, 23 Okt 13:00" or "Sel, 27 Okt 10:00"    |
| `none`     | no open step    | dashed `line-strong` button "+ Tambah langkah berikutnya"                |

- The title is always `ink`. Only the time line takes the state colour, so the text stays readable.
- Clicking opens the step editor. On won, lost or done cards the `none` state is allowed and hidden.
