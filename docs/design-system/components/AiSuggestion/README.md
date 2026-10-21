# AiSuggestion

One AI suggestion card in the Saran AI section (Strategi, client Ringkasan). AI only suggests: nothing is written to deals, plans or steps until a person clicks the primary button.

**Consumer provides:** `kind` (risk / opportunity / pipeline → "Risiko" / "Peluang" / "Pipeline"), the insight (what the AI noticed), the proposed action, and the accept and dismiss handlers.

- The insight is in bold and the action in `ink-2` under it. Write both in Bahasa Indonesia and keep each to one or two sentences.
- **Primary:** "Tambahkan ke rencana" (or "Buat langkah" when it becomes a single step). **Secondary:** "Abaikan".
- The section wrapper has a `ai-line` border, the 3D agent illustration in the header, "Dibuat tiap pagi dari riwayat klien · 07:30", and the note "Saran AI bisa keliru. Periksa dulu sebelum dipakai." at the bottom.
- Use the AI palette (`ai`, `ai-bg`, `ai-line`) only here and on AI buttons and chips.
