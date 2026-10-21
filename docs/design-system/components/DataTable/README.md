# DataTable

Tabular records such as transactions, clients and invoices, with its filter row above.

**Consumer provides:** columns, rows, and the filter state (search text, type, period).

- **Filter row:** `bf-search` (searches description and category), the type toggle (Semua / Masuk / Keluar), then the PeriodFilter. All filters combine. Show "Menampilkan x dari y transaksi".
- **Amounts:** right-aligned, full format `Rp 24.000.000`, with "+" in `success` for income and "−" in `danger` for expense.
- **Status:** a Chip (Dibayar plain, Direncanakan dashed).
- **Wide tables** scroll inside `bf-table-wrap`. The page never scrolls sideways.
- **Empty result:** "Tidak ada transaksi yang cocok dengan filter."
- Lists longer than 25 rows use the `bf-pager--md` Pager.
