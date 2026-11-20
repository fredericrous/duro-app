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

## Handoff

2026-11-20, boundary: t03 closed (`refactor/drop-show-detail`).

- Done: [t03](t03-admin-show-detail-unused.md): `showDetail` and the
  context's `isWide` removed from `admin.tsx` and its test stubs, and
  `CLAUDE.md`, `features/admin.md` and the test setup comment updated.
  Typecheck, lint and the 186 admin tests pass.
- Filed from this session: [t08](t08-cert-panel-narrow-screens.md).
- Next, in order: t04, t06, t05, t07, t08.
- Lesson (from t01, still true): a cold dev start takes 30-100 s here
  under load, so the verify skill's Launch can miss its deadline (t05).

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
