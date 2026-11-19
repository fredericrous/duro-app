+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Wire or remove admin's showDetail

## Question

`app/routes/admin.tsx` offers `showDetail` (a `DetailPanel` when wide, a
route when narrow) through its outlet context, and no admin route calls
it (2026-11-19). `CLAUDE.md` still describes the DetailPanel-vs-navigate
choice. Should identities and applications open rows in the panel, or
does the panel go?

## Look at

- `app/routes/admin.tsx` (`showDetail`, `isWide`, the `DetailPanel`).
- The admin routes' row clicks (`admin.identities.tsx`,
  `admin.applications.tsx`) and the git history of the panel's callers.
- `CLAUDE.md` § Page shell, and `verify-duro-app`'s `features/admin.md`.

## Answer looks like

One PR that either wires rows to `showDetail` (with a test) or removes
it, and updates `CLAUDE.md` and `features/admin.md` to match.
