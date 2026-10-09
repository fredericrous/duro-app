---
canonical: duro-design-system:docs/plans/2026-10-09-raw-values-lint-and-chrome-theme.md
phases: [3]
status: active
---

Part of [Raw values in shorthands and inline styles; editor chrome keeps its theme](https://github.com/fredericrous/duro-design-system/blob/main/docs/plans/2026-10-09-raw-values-lint-and-chrome-theme.md), with Duro released as **5.9.0**.
This repository carries Phase 3: delete the unused `ButtonLink` (its shorthand paddings are the new lint's only css.create hits here), move `@duro-app/*` to `^5.9.0`, and fix the one inline-style hit.

## Phase 3 record (observed before push)

| Input                                 | Expected | Actual                                                                                                                   |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint` on `@duro-app/*` 5.9.0 | 0 errors | 0 errors, 8 warnings (as on main); ButtonLink deleted; the inline `fontWeight: 500` is now `typography.fontWeightMedium` |
| typecheck, build                      | pass     | pass                                                                                                                     |
| `npx vitest run`                      | pass     | 168 files, 1550 tests pass                                                                                               |

Decision (2026-10-09): the bump surfaced one failing test, `ApprovalGates › dropping a roster person on the track slots them at the dropped index`. Bisected to Duro **5.7.0** (#89, DragDrop rework): passes on 5.6.0, fails on 5.7.0, 5.8.x and 5.9.0. 5.7 captures the pointer and finds the drop zone with `document.elementsFromPoint`, which jsdom lacks, so the test threw and then dropped into the wrong zone on jsdom's 0×0 layout. This is not a product regression: DS's own browser story drags onto a gates zone. Fixed test-side:

- `app/test/setup.ts` adds pointer capture and a rect-based `elementsFromPoint`;
- the test declares the zone under the pointer and the owner gate's position;
- falsified: without the owner's position it fails again.

Out of this plan's phases, recorded here.
