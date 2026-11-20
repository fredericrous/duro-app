+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Admin mutations 403 in a verify run

## Question

verify-duro-app serves the app on `127.0.0.1`, while the dev default of
`ALLOWED_ORIGIN_SUFFIX` is `localhost`. Every admin mutation behind
`requireAdminAction` then answers 403 "Invalid origin" and the page shows
"Something went wrong" (seen 2026-11-20 in t08: a cert Revoke from
`http://127.0.0.1:<port>`; the same click from `http://localhost:<port>`
answered 200). Should Launch set the suffix, or the brief open
`localhost`?

## Look at

- `.claude/skills/verify-duro-app/scripts/verify.py` (`DEFAULTED`, the
  brief's URL, `--host 127.0.0.1`).
- `app/lib/config.server.ts` (`allowedOriginSuffix`, `isOriginAllowed`).

## Answer looks like

One PR where a verify run's admin mutation answers 200, with the
script's test covering it, and `features/admin.md` naming a mutation step.
