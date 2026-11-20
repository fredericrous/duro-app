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

## Handoff

2026-11-20, boundary: t04 closed (`fix/settings-admin-a11y`).

- Done: [t04](t04-settings-admin-a11y-findings.md): the identities select
  column is labelled, the API keys scopes are a named `Fieldset` group,
  the key name has `autocomplete="off"`, and every settings page has one
  visually hidden `h1`. Each fix has a test that failed on the old code;
  the browser re-check at 1280 and 390 px shows no dangling `for`, no
  missing `autocomplete` and no HeaderCell warning.
- Upstream: greenharness/greenrack#200 (modal Drawer focus, and the
  HeaderCell `label=""` warning). It reaches duro-app with the
  greenrack-rename sweep (decisions `greenrack-rename/t08`).
- Filed from this session: [t10](t10-admin-h1-and-unnamed-field.md).
- Next, in order: t06, t05, t07, t08, t09, t10.
- Lesson (from t01, still true): a cold dev start takes 30-100 s here
  under load, so the verify skill's Launch can miss its deadline (t05).
  This session's warm Launch was ready well inside it.

## Not yet specified

- Nothing.

## Out of scope

- Nothing.
