+++
type = "task"
mode = "afk"
status = "closed"
blocked_by = []
repos = ["duro-app"]
+++

# Four accessibility findings on settings and admin

## Question

`browser-check`, driven through `verify-duro-app` on 2026-11-19,
reported: at 390 px the settings Menu drawer keeps focus on the Menu
button, so focus never enters the drawer; a `Table.HeaderCell` with JSX
children has no `label` (console warning on admin); an API keys form
field lacks `autocomplete` and a `<label for>` matches no field; the
settings General page has no `h1`. Which are real defects, and which
belong upstream in the design system?

## Look at

- `app/components/AppShell` and the drawer it opens; the design system's
  Drawer focus handling.
- The admin tables' `Table.HeaderCell` uses, `settings.api-keys.tsx`,
  `settings._index.tsx`.
- Reproduce with `verify-duro-app`: `brief … settings` and `brief …
admin`.

## Answer looks like

Each finding confirmed or dismissed; app fixes in one duro-app PR with
accessibility tests, and a design-system issue for anything that is the
component's.

## Resolution

2026-11-20: all four confirmed with `verify-duro-app` and `browser-check`.
Two are the design system's, three are fixed here (one finding had both).

- Drawer focus: the design system's. A modal `Drawer` moves no focus into
  its panel, traps no Tab and hands none back. That holds in 5.9.0 (which
  duro-app runs) and on greenrack `main`. Measured at 390x844: focus stayed
  on Menu and Tab walked the page behind the backdrop. Filed as
  greenharness/greenrack#200. It reaches duro-app with the greenrack-rename
  fleet sweep (decisions `greenrack-rename/t08`); AppShell keeps no trap of
  its own.
- `Table.HeaderCell` warning: the app's. The identities select column's
  header is a checkbox, so its label was `""`; it is now "Select", which
  also names the cell in stack mode. The warning firing on an explicit
  `label=""` (the documented opt-out) is the design system's, in the same
  issue.
- API keys: the app's. The scopes `Field.Label` pointed `for` at no
  element (a set of checkboxes is not one control); the field is now a
  `Fieldset` with a `Legend`, a group named "Scopes", same label style.
  The key name input has `autocomplete="off"`.
- No `h1`: the app's, on every settings page, not only General. The
  settings layout renders one visually hidden `h1`, named after the open
  page; the rail already shows it, so the visible design is unchanged.

Tests: one per app fix, each red on the old code. After: no dangling
`for`, no input without `autocomplete`, `H1: General` / `H1: API keys`
at 1280 and 390 px, no HeaderCell warning on `/admin/identities`.
