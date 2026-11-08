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
- The new dependency `@aval-adr/eslint-config` `^0.16.0` is the required peer of `@duro-app/eslint-config` 6. adr-lint owns it, with the same owner as Duro, and it now supplies `effect`, `tests` and `adrLint` (`change.a-new-dependency-is-owned`).

## Verification

| Check                                                                                  | Expected           | Actual                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `eslint . -f json`, before vs after                                                    | the same error set | 5 errors both times, the same file/rule/line, none new and none gone                                                             |
| stdin probe `app/probe-design-part.ts` importing `@radix-ui/react-dialog` and `kysely` | both refused       | `duro/no-restricted-imports` and `@typescript-eslint/no-restricted-imports` both reported (in 5.x, `effect` overrode the UI ban) |
| `pnpm-lock.yaml` `@aval-adr/eslint-config` entries                                     | one version        | `0.16.0` only                                                                                                                    |
| `npx @duro-app/cli@6.0.0 hook install --check` / `skill install --check`               | exit 0             | 0 / 0; the hooks now pin `^6.0.0`, and the grh pointer is printed on stderr                                                      |
| `pnpm typecheck`, `pnpm test`                                                          | pass               | pass                                                                                                                             |

## Implementation review

- Round 1: approve-with-changes (55k, 25 s). Fixed outside the tree: the Verification table and the dependency ownership above. The pack refresh is a generated vendored file.

## Interface review

- No interface change (34k, 22 s). Deliberate: the CLI floor is `^6` while ui stays on 5.9. The old `^5.0.0` floor already resolved to 5.45 against the same ui 5.9, so the catalog-versus-installed drift is not new; the ui catch-up rides the Duro 5.x programme. Already measured: the v6 lint rules give the same error set on the 5.9 styles.
