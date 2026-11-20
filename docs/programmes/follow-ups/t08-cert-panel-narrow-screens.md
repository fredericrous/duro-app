+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Cert panel on narrow screens

## Question

`app/routes/admin.tsx` renders its `DetailPanel` only when `isWide`. The
identities screen's cert toggle calls `onOpenChange(true)` and
`setContent(<CertPanelContent …/>)` whatever the width, so below `md` the
toggle likely opens nothing (seen in code 2026-11-20, not yet in a
browser). Does a phone-width admin have any way to see and revoke one
user's certificates?

## Look at

- `app/routes/admin.tsx` (the `aside`, `isWide`).
- `app/routes/admin.identities.tsx` (`toggleCertPanel`, the button that
  calls it) and `CertPanelContent`.
- The verify skill's `features/admin.md`, step 4 (390x844).

## Answer looks like

A browser check at 390x844 that says what the toggle does. If it does
nothing, one PR where the panel content opens on narrow screens too (a
Drawer, or the panel in a narrow size), with a test, or the toggle is
hidden there with the reason written down.
