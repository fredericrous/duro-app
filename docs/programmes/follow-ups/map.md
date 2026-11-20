# duro-app: follow-ups found while doing other work

## Destination

Every follow-up a session noticed outside its own task is either answered
or closed as not worth doing. Reached when no ticket here is open.

## Notes

- Filed from a session's inbox at its boundary (worktree-task Handoff),
  one task ticket per line.

## Decisions so far

- [t01](t01-first-visit-hook-call-crash.md): the dev server pre-bundles
  every client dependency at startup (`future.unstable_optimizeDeps` plus
  `loader: "jsx"` on the app babel rule), and any "Invalid hook call" is a
  defect.
- [t02](t02-raw-i18n-keys-on-admin.md): the raw keys were the t01 crash,
  not a missing namespace.
- [t03](t03-admin-show-detail-unused.md): admin's `showDetail` is gone. A
  record's detail is its own route, and the `DetailPanel` serves only the
  identities cert panel.
- [t04](t04-settings-admin-a11y-findings.md): the modal Drawer's focus and
  the HeaderCell `label=""` warning are the design system's
  (greenharness/greenrack#200, reaching duro-app with the greenrack
  sweep); the select column label, the scopes group, autocomplete and the
  settings `h1` are fixed in duro-app.
- [t05](t05-launch-deadline-cold-start.md): verify-duro-app Launch waits
  while the server group gains CPU (2 CPU-s per 30 s, 450 s cap), not
  for a fixed 120 s; a start costs about 75 CPU-s cold, 50 warm.
- [t06](t06-server-packages-in-client-graph.md): server packages in the
  dev pre-bundle set are expected and stay. The browser never imports
  them, the production client bundle has none, and filtering them out of
  the scan brings back t01's late re-bundle.
- [t07](t07-duplicate-family-group.md): the dev seed's Family is
  `grp-family`, the principal migration 0026 creates; production never
  had a second one.
- [t09](t09-cert-toggle-setstate-in-render.md): the cert toggle calls
  the layout's setters from its click handler, never inside a state
  updater, because StrictMode replays updaters during render.

## Handoff

2026-11-20, boundary: t09 closed (`fix/cert-toggle-updater`).

- Done: [t09](t09-cert-toggle-setstate-in-render.md): the cert toggle
  no longer updates AdminLayout during render, and the browser shows no
  error. Filed [t13](t13-rail-collapses-with-cert-panel.md) (rail
  collapses while the panel is open, same on main).
- Live state: t08 is in flight on `fix/cert-panel-narrow` (another
  session). It also edits this map, so whichever lands second merges
  the Decisions and Handoff sections.
- Next, in order: t08, t10, t11, t13.
- Lesson: a "setState in render" warning that a test cannot reproduce
  may need StrictMode. It replays updaters during render, while a plain
  render runs them eagerly in the event handler.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
