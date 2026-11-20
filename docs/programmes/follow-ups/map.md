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
- [t10](t10-admin-h1-and-unnamed-field.md): the admin layout gives each
  page a visually hidden `h1` named after its rail item, as settings
  does. The unnamed field is greenrack's `Combobox.Input`
  (greenharness/greenrack#203).
- [t11](t11-launch-ignores-dep-reload.md): verify-duro-app fails on
  vite's `optimized dependencies changed. reloading` line in Launch,
  Doctor and Drive, reading the log once the server group is quiet,
  since the line comes about 1 s after ready.
- [t13](t13-rail-collapses-with-cert-panel.md): the admin rail giving way
  to the Menu button while the 480 px cert panel is open, below a
  viewport of about 1296 px, is intended: a 360 px panel keeps the rail
  but squeezes the identities table into 279 px rows.

## Handoff

2026-11-20, boundary: t13 closed (`fix/rail-with-cert-panel`, docs only).

- Done: [t13](t13-rail-collapses-with-cert-panel.md): the rail giving way
  to the Menu button while the cert panel is open at 1280 is intended,
  measured at 1280, 1440 and 1920 with the 480 px and 360 px panels; no
  code change, no greenrack issue.
- Live state: t08 is PR #177 (`fix/cert-panel-narrow`, another session,
  no checks reported on it at 08:55). It edits this map too, so whichever
  lands second merges the Decisions and Handoff sections.
- Next, in order: t08 (if still open).
- Lesson: a layout trade-off check needs the panel's real rows (Alice
  has 3 seeded certs) and the page's own height, not only the rail's
  width: the 360 px panel kept the rail and tripled the page's height.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
