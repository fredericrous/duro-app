+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Why raw translation keys showed on admin tables

## Question

`browser-check` saw `ADMIN.COLS.NAME` and similar keys on admin tables in
dev on 2026-11-19, right after the first-visit crash (t01), although
`admin.cols.name` exists in `app/locales/en/translation.json`. A later
clean load did not show them. Is it a consequence of t01, or a real
missing-namespace path?

## Look at

- i18next setup for the admin routes and how resources reach the client.
- Repeat after t01 is fixed: open `/admin/identities` cold.

## Answer looks like

Either "gone with t01" with the cold-load check that shows it, or the
fix and a test that renders an admin table with its translations.
