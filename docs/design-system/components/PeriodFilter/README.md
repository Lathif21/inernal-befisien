# PeriodFilter

The one time filter used on Dashboard, Strategi, Keuangan and the client transaction table. It must look and behave the same everywhere.

**Consumer provides:** the current period from the URL (`?period=month&from=2026-10-01`) and an `onchange` handler. The component resolves ranges through `lib/period.ts`.

- **Options, in this order:** Harian · Mingguan · Bulanan · Tahunan · Custom. The selected option is `aria-pressed="true"` and filled `accent`.
- **Prev / next arrows** move by one period. "Next" is disabled when the next period starts in the future.
- **Label:** `1 – 31 Okt 2026`, `19 – 25 Okt 2026` (weeks run Monday to Sunday, WIB), `Tahun 2026`.
- Custom opens a date-range picker in a popover.
- **Defaults:** Dashboard Bulanan, Strategi Mingguan, client transactions Tahunan.
- The same segmented style with `bf-seg--dark` (navy selection) is used for non-time toggles: Semua / Masuk / Keluar and Semua / Saya.
