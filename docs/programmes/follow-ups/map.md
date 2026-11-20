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

## Handoff

2026-11-20, boundary: t07 closed (`fix/dev-seed-one-family`).

- Done: [t07](t07-duplicate-family-group.md): production has one Family
  (`grp-family`); the dev seed's `g-family` came from a seed older than 0026. The seed now reuses `grp-family`.
- Live state: nothing in flight.
- Next, in order: t08, t09, t10, t11.
- Lesson: an `ON CONFLICT DO NOTHING` seed can lose a row to a later
  migration's unique key without a word; check the merged state, not
  the seed's source.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
