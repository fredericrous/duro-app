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

## Handoff

2026-11-20, boundary: t05 closed (`fix/launch-cpu-progress`).

- Done: [t05](t05-launch-deadline-cold-start.md): Launch's fixed 120 s
  deadline is gone. It now waits while the server group makes CPU
  progress, fails as `stalled` after 30 s with under 2 CPU-s, and caps
  at 450 s. Probes that time out were measured and do not slow the start.
- Live state: nothing in flight.
- Next, in order: t06, t07, t08, t09, t10.
- Lesson: run verify-duro-app Launch with the Bash tool timeout at
  600000 ms; at the default 120 s a loaded start gets SIGKILLed before
  it can tear down.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
