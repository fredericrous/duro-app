+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

2026-11-20: the collapse is intended, and the panel stays `md` (480 px).

- Measured on origin/main (e4871ec), cert panel of Alice (3 certs) open:
  at 1280x800 the shell's grid is 752 px, below `split-wide`'s 768 px
  (`md`) threshold, so the rail goes to 0 px and the Menu button shows;
  the identities table keeps 783 px, with no horizontal overflow and no
  page scroll. At 1440x900 the rail stays (280 px + 600 px, table
  582 px), and at 1920x1080 nothing moves (280 + 840). Closing the
  panel brings the rail back.
- Tried: panel `size="sm"` (360 px). The rail stays at 1280 (grid 872 =
  280 + 560), but the content column drops to 560 px: the table is
  542 px wide, its rows wrap to about 279 px tall, and the page grows
  from 800 to 1950 px tall, which pushes the panel's Revoke footer
  below the fold. The cert rows' "Issued … · Expires …" line is also
  clipped with an ellipsis (222 px of text in 183 px). That is worse
  than swapping the rail for the Menu button, so it was reverted.
- Why intended: greenrack's Grid documents `split-wide` collapsing on
  its own container "beside an open DetailPanel" (`Grid.tsx` layout
  doc), and AppShell's header comment relies on it. While the panel is
  open, the record being inspected matters more than the rail, and the
  rail is still one click away (Menu). An overlay would cover 480 px of
  the same table, and DetailPanel has no overlay mode, so no greenrack
  issue is filed.
- The threshold, for the record: with a 480 px panel the rail stays from
  a viewport of about 1296 px (768 + 480 + 48 px of page padding).
