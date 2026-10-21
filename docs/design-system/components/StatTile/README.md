# StatTile

One headline number with a label and a comparison. Used in rows of four on the Dashboard, the client finance strip and Keuangan.

**Consumer provides:** the label, the value already formatted with `rupiahShort()`, and the delta (percentage plus direction) with whether "up" is good.

- Values use the `kpi` style with tabular numerals.
- **Delta wording:** "▲ 35% vs periode sebelumnya" or "▼ 12% vs periode sebelumnya". Good = `--good`, bad = `--bad`. For costs, an increase is bad.
- Use `bf-stat--dark` (navy) for exactly one tile per row: the profit tile.
- Use `--neutral` for counts that are not good or bad ("18 deal terbuka").
- **Planned amounts** (Pemasukan Direncanakan) use a dashed `line-strong` border and `accent-ink` value.
- Never show a tile with an invented number. Show `[XX]` until data exists.
