# Chip

A small pill that labels a state, a type or a link. Chips are never clickable on their own; wrap one in a button or link if it must act.

**Consumer provides:** the text and the variant. Keep it under about 40 characters.

- **Service type:** `bf-chip--service` (AI Agent · Otomasi · Integrasi · Dashboard · Web & CMS · AI Energi).
- **Linked card on a plan:** `bf-chip--accent` for a deal and `bf-chip--dark` for a project, formatted "Deal · Stage · Rp 38 jt".
- **Status:** `bf-chip--success` for Aktif and good deltas, plain for Dibayar, `bf-chip--planned` (dashed) for Direncanakan.
- **Urgency:** `bf-chip--danger` for "x hari" late, `bf-chip--warning` for Hari ini.
- **AI origin:** `bf-chip--ai`, only for content created from an AI suggestion.
- **Deltas:** an arrow plus "vs periode sebelumnya". Use green for good and red for bad: an expense going up is red.
