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
- [t08](t08-cert-panel-narrow-screens.md): admin's side content opens
  as a right Drawer below `md` and as a DetailPanel above it; content
  built for it uses `DetailSurface.*` parts and names its route's action.
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

2026-11-20, boundary: t08 closed (`fix/cert-panel-narrow`), after t09,
t10, t11 and t13 (another session).

- Done: [t08](t08-cert-panel-narrow-screens.md): below `md` the cert
  panel opens as a right Drawer (`AdminDetailSurface`); a row's Revoke
  now posts to `/admin/identities`, and a checkbox ticks once per click.
  Revoke was broken at every width before. [t13](t13-rail-collapses-with-cert-panel.md):
  the rail giving way while the wide panel is open is intended.
- Live state: nothing in flight.
- Next, in order: t12.
- Lessons: a node a child route hands the layout (`setContent`) renders
  under the layout's route, so `useFetcher` forms in it need an explicit
  `action`. A verify run serves 127.0.0.1 while the dev origin check
  wants `localhost`: drive admin mutations through `localhost` until
  [t12](t12-verify-origin-403.md). A layout trade-off check needs the
  panel's real rows and the page's own height, not only the rail's width.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
