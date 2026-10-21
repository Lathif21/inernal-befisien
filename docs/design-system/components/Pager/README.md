# Pager

Page navigation for long lists. It keeps pages fast by loading only the visible slice.

**Consumer provides:** current page, total count, page size and an `onpage` handler. List pages keep the page in the URL (`?plans=2`). A pager inside a card keeps it in component state.

| Size           | Where                                             | Info text                                                      |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `bf-pager--md` | Under a list: Strategi plans (3 per page), tables | "Menampilkan rencana 1–3 dari 5", with Sebelumnya / Berikutnya |
| `bf-pager--sm` | Inside a card: plan steps (4 per page)            | "Langkah 1–4 dari 6", arrows only                              |

- The current page has `aria-current="page"` (navy fill). Arrows at either end use `disabled`.
- Hide the pager entirely when there is only one page.
- Show at most 7 page buttons, then use an ellipsis.
