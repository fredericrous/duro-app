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

## Handoff

2026-11-20, boundary: t10 closed (`fix/admin-h1-unnamed-field`).

- Done: [t10](t10-admin-h1-and-unnamed-field.md): every admin page has
  one `h1`. The unnamed field Chrome flags is greenrack's
  `Combobox.Input`, filed as greenharness/greenrack#203.
  `/admin/group-mappings` logs the same issue (count 4), not followed.
- Live state: t08 may still be in flight on `fix/cert-panel-narrow`
  (another session). It also edits this map, so whichever lands second
  merges the Decisions and Handoff sections.
- Next, in order: t08 (if still open), t11, t13.
- Lesson: Chrome's "form field should have an id or name" count seems
  to leave out checkboxes and switches (on identities, 6 unnamed inputs
  gave a count of 1). Compare the count with the text-like fields, not
  with every input.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
