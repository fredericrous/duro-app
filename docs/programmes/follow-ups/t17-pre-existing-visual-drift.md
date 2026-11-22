+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
due = "2026-12-05"
repos = ["duro-app"]
+++

# Pre-existing drift found during the greenrack sweep

## Question

The sweep found drift that was already on main: `global.css` dark muted `#888` and accent `#3b82f6` differ from the DS values; the cert Drawer does not take focus on open; the 404 page ignores the light theme; verify-duro-app's generated-from hashes are stale for six files. Which are worth fixing, and in which order?

## Look at

- `app/global.css`, the cert Drawer in `app/routes/admin*`, the 404 route.
- `.claude/skills/verify-duro-app/` and its generated-from hashes.

## Answer looks like

One line per item: fix (with its PR) or close as not worth doing, with the reason.
