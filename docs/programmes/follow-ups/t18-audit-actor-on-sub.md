+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Audit actors recorded as display names, not `sub`

## Question

The cert-revocation work (plan 2026-11-25, Phase 1) made admin revokes
record the actor as the admin's `sub`. Older audit paths still record a
display name: recovery approve and deny pass `auth.user ?? auth.sub ??
"admin"`, and the settings mutations pass `auth.user!`. Should every
audit `actorId` be `auth.sub`, and which call sites change?

## Look at

- `app/routes/admin.recovery.tsx:47` and `:55`
  (`approveRecovery` / `denyRecovery` actor argument).
- `app/lib/mutations/settings.ts` (`auth.user!` where it reaches an audit
  event, as opposed to a username lookup that must stay `auth.user`).
- `app/lib/workflows/cert-revocation.server.ts` for the Phase 1 shape.

## Answer looks like

Each audit call site listed with its current actor and the fix (`sub`, or
kept with the reason), and the PR that aligns them, with a test asserting
`actorId` is the `sub`.
