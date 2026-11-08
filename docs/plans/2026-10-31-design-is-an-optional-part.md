---
canonical: fredericrous/decisions docs/plans/2026-10-31-design-is-an-optional-part.md
phases: [8]
status: active
branch: chore/duro-6-lint-split
---

# Design is an optional part: duro-app pilot (pointer)

This repository's slice of the ADR-0048 plan is section 8, the pilot:

- `@duro-app/eslint-config` and `@duro-app/eslint-plugin` go to `^6.0.0`;
- `@aval-adr/eslint-config` `^0.16.0` is added;
- `react` comes from Duro, and `effect`, `tests` and `adrLint` come from
  aval, with `stack` dropped;
- the repo-level hooks and skills are regenerated with `@duro-app/cli@6.0.0`;
- `CLAUDE.md`'s lint paragraph is updated.

## Decision log

- 2026-11-08 — **deviation from the canonical §8: `@duro-app/ui`, `tokens`
  and `ui-email` stay on `^5.9`.** The plan bumped them too, so that lint
  6 beside ui 5 would not install tokens twice. The published
  `@duro-app/eslint-plugin@6.0.0` and `@duro-app/eslint-config@6.0.0`
  depend on no `@duro-app/tokens`, so that risk does not exist. duro-app's
  lockfile holds ui and tokens at 5.9.0, so a bump to 6 would carry 36
  releases of 5.x changes, which is the Duro 5.x migration programme's work,
  not this pilot's. The lint split is what the pilot proves.
