+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

Task, 2026-11-20. Gone with [t01](t01-first-visit-hook-call-crash.md).

- `react-i18next` was one of the dependencies vite found late. The crashed
  page held two copies of it. The provider of one copy is invisible to
  the hooks of the other, so `t` returns the key.
- **Check:** on the t01 fix, `browser-check` opened `/admin/identities`
  cold, as the first visit of a fresh isolated context, and found no
  visible text, `aria-label`, `title` or `placeholder` shaped like a key.
  It did not scan `/admin/applications` or the detail page.
- If keys come back on a page with no crash, reopen this with that page.
