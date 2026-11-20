+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

2026-11-20: Launch sets the suffix, so a verify run stays on one host.

- `verify.py` moves `ALLOWED_ORIGIN_SUFFIX` from `DEFAULTED` to
  `SET_BY_LAUNCH` and sets it to `HOST` (`127.0.0.1`), the one constant
  behind `--host`, the pidfile's `base` and `OIDC_REDIRECT_URI`. The
  brief keeps opening `127.0.0.1`: switching it to `localhost` would
  break the loopback-only checks (`http()`, `check_isolation`, the
  brief's "a host other than 127.0.0.1" rule).
- `test_verify.py` `OriginCheck`: the env Launch builds allows the
  hostname of the URL the brief opens (a KeyError before the change).
- `features/admin.md` step 5 revokes one of Alice's certificates. Run
  on this branch: `POST /admin/identities.data` with Origin
  `http://127.0.0.1:55707` answered 200 (`certRevoked: true`), the row
  reads Revoked, no "Something went wrong"; `drive` home, catalog,
  settings and admin passed.
