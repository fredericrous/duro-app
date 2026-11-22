+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
due = "2026-12-05"
repos = ["duro-app"]
+++

# The app detail action row runs into the page padding at 390

## Question

At 390 px touch, the app detail page's action row runs 15 px into the page padding (found in the greenrack sweep; greenrack#204 / 7.2.1 fixed the Button side). Should the row wrap, or move into a menu below a width? This is a design change, so it was left out of the no-UI sweep.

## Look at

- The app detail route's action row (`app/routes/`), and the greenrack `action-menu` recipe and `Cluster`.
- The sweep plan's 390 touch capture in `docs/plans/` (greenrack sweep).

## Answer looks like

A picked layout for the row at 390 (wrap or menu), proven by a 390 touch browser check that finds no overflow, then the fix as its own PR.
