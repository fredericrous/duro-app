+++
type = "task"
mode = "afk"
status = "open"
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
