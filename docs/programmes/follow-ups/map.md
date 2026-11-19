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

## Handoff

2026-11-20, boundary: t01 closed (first-visit crash fixed on
`fix/first-visit-dep-scan`), t02 closed with it.

- Done: [t01](t01-first-visit-hook-call-crash.md): vite's scan had no
  entries and failed on babel's JSX output, so client dependencies were
  found on the first visit. Fixed by `future.unstable_optimizeDeps` and
  `loader: "jsx"`. [t02](t02-raw-i18n-keys-on-admin.md): the raw keys
  came from the same crash, and a cold load is clean.
- Filed from this session: [t05](t05-launch-deadline-cold-start.md),
  [t06](t06-server-packages-in-client-graph.md),
  [t07](t07-duplicate-family-group.md).
- Next, in order: t03, t04, t06, t05, t07.
- Lesson: on this machine a cold dev start takes 30-100 s under load. The
  verify skill's Launch can miss its deadline (t05). Starting the server
  with Launch's environment by hand and polling `/health/ready` with a
  long timeout got around it.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
