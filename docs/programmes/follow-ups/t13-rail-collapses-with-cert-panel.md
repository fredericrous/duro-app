+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# The admin rail collapses while the cert panel is open

## Question

At 1280x800 on `/admin/identities`, opening an identity's cert panel
(480 px) shrinks the page grid from 1152 px (280 + 840) to 752 px. The
`split-wide` layout then collapses, the side navigation measures 0 px
and the Menu button is shown. It comes back when the panel closes
(browser check, 2026-11-20, same on origin/main and on the t09 fix).
Is losing the rail while a panel is open intended for a wide screen,
or should the panel sit beside the rail, overlay the content, or move
the threshold?

## Look at

- `app/routes/admin.tsx` (the `aside` and the DetailPanel that pushes
  the page).
- `app/components/AppShell` (the `split-wide` grid and where it
  collapses).
- The greenrack `page-with-sidenav` recipe and `DetailPanel`'s push
  versus overlay behaviour.

## Answer looks like

A browser check at 1280x800 and 1440x900 that measures the rail with
the panel open. Then either a written reason that the collapse is
intended, or one PR (or a greenrack issue, if the gap belongs to the
design system) that keeps the rail visible.
