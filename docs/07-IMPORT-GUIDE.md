# 07 — Moving the Plain Notes into the CRM

The current client data is in plain notes. The fastest path is to put it into `import-template.csv`, one row per client, and upload it in **Pengaturan → Import Data**.

## Columns

| Column             | Required                | Allowed values / format                                                                                                           | Example                       |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `client_name`      | ✔                       | text                                                                                                                              | PT Sinar Energi Nusantara     |
| `industry`         |                         | manufacturing, energy, logistics, finance, education, other                                                                       | energy                        |
| `city`             |                         | text                                                                                                                              | Surabaya                      |
| `source`           |                         | website, referral, apollo, event, existing_network, other                                                                         | referral                      |
| `contact_name`     |                         | text                                                                                                                              | Budi Santoso                  |
| `contact_position` |                         | text                                                                                                                              | Direktur Operasional          |
| `contact_phone`    |                         | any format. Normalised to `628…`.                                                                                                 | 0812-3456-7890                |
| `contact_email`    |                         | email                                                                                                                             | budi@sinarenergi.co.id        |
| `deal_title`       |                         | text. Leave empty if there is no open opportunity.                                                                                | AI Monitoring PLTS            |
| `service_type`     |                         | ai_agent, automation, integration, dashboard_app, web_cms, energy_ai, other                                                       | energy_ai                     |
| `deal_stage`       | if `deal_title` is set  | lead, contacted, meeting, proposal, negotiation, won, lost                                                                        | proposal                      |
| `deal_value`       |                         | number only, no dots or "Rp"                                                                                                      | 85000000                      |
| `next_action`      |                         | text. Becomes the first step of the deal.                                                                                         | Follow up proposal via WA     |
| `next_action_due`  | if `next_action` is set | YYYY-MM-DD or YYYY-MM-DD HH:MM (WIB). Excel dates such as 24/10/2026 10:00 are read too; an ambiguous one (03/04/2026) is refused | 2026-10-24 10:00              |
| `notes`            |                         | free text (keep it on one line, or wrap it in quotes)                                                                             | Kenalan dari pameran MFS 2026 |

## Rules the importer applies

- A client with the same name (case-insensitive) is **not** duplicated. The contact and deal are added to the existing client.
- Rows with errors are shown in red in the preview and skipped. Valid rows import in one go. If anything fails, nothing is saved.
- The owner of imported clients and deals = the user doing the import.
- `deal_stage = won` also creates a project in `onboarding`.

## Tip: let Claude convert the notes

Paste the notes into a chat and ask:

> "Convert these notes into rows for import-template.csv (columns: …). Use the allowed values exactly. Put anything that doesn't fit into `notes`. Show me the rows that are unclear."

Check the result, save it as `.csv` (UTF-8), and upload it.

## Money history

Past payments and costs are not part of the client CSV. Enter them in **Keuangan → + Transaksi**. For a small number this is quicker than a second import. If there are many, a transactions CSV importer can be added (it is not in the current plan).
