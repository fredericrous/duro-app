---
status: active
canonical: greenharness-skills/docs/plans/2026-11-19-create-verify-skill.md
phases: [3]
branch: feat/verify-duro-app-skill
plan-id: p-01M7RHEVCDPVY8G73YMGXRYPNQ
---

# A generator skill writes each repo's verify skill (pointer)

The canonical plan lives in greenharness-skills
(`docs/plans/2026-11-19-create-verify-skill.md`). This repository carries
Phase 3, the second pilot and the first user interface:
`create-verify-skill` writes `.claude/skills/verify-duro-app/` and runs it
once; its Drive hands the browser work to the `browser-check` agent.

## Code review

- duro-app: unix (the verify skill carries dev-server launch/kill shell; backend left out: no code, markdown and shell only)

## Verification record

F2 of this PR ran through `verify-duro-app` (the skill it adds), from
the worktree, Launch, Drive and Cleanup as separate tool calls.
Evidence: `attestations/c88449a/` (final tree), `attestations/433aea9/`
(fresh run 2), `attestations/dc0644b/` (fresh run 1),
`attestations/3b03265/` (the generator's own run).

| Check                | Input                                                            | Expected                                                             | Actual                                                           |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Launch               | `verify.py launch`, empty state                                  | pidfile path, exit 0, ready ≤ 120 s                                  | ok, about 20 s                                                   |
| Doctor               | `verify.py doctor <pf>`                                          | `ok: …dev sign-in, <n> seeded apps`, exit 0                          | `ok: ready on :49298, dev sign-in, 11 seeded apps`               |
| Second Launch        | `launch` while up                                                | `fail: already running`, nothing started                             | as expected, exit 1                                              |
| SSR drive            | `drive … home catalog settings admin`                            | 4 × `ok:`, JSON outside the worktree                                 | 4 passed, `git status` unchanged                                 |
| browser-check        | `brief` for catalog, admin, settings, passed verbatim            | report answers every step                                            | answered; it found 4 wrong feature statements, fixed (see below) |
| Cleanup              | `cleanup <pf>` beside a same-named `node` decoy in its own group | group (node, esbuild) empty, state dir and pidfile gone, decoy alive | all as expected, exit 0                                          |
| Cleanup, no pidfile  | `cleanup` again                                                  | `fail: no pidfile`, exit 1                                           | as expected                                                      |
| Interrupt mid-launch | SIGINT, then SIGTERM, 1 s after the group started                | exit 130 / 143, no group, state dir or pidfile                       | as expected for both                                             |
| Refused launch       | a `.env` in the worktree, then Cleanup                           | exit 2, no state; Cleanup `fail: no pidfile`                         | as expected                                                      |
| Env guard            | an `app/` file reading `NEW_SERVICE_URL`                         | exit 2 `fail: unclassified env …`                                    | as expected                                                      |

Repairs on the way (the generator's run, before the skill was
committed): starting `node …/bin.js` lost the pnpm shim's `NODE_PATH`,
so babel could not resolve `@stylexjs/babel-plugin` and every page was
a 500 (fixed: start through `node_modules/.bin/react-router`); the
failure log path pointed into the removed state directory (fixed: a
copy beside the pidfile); macOS answered `EPERM` to a `killpg` on an
exiting group (handled). Home's seeded marker was a guess and wrong.

Pilot bar (a fresh session with no prior context completes F2 using
only `verify-duro-app`):

- run 1 (`dc0644b`): every step ran with 0 repairs in about 5 min, and
  the fresh agent launched `browser-check` itself; F2 **failed** on
  content: `admin.md` and `settings.md` stated behaviour the app does
  not have (a detail panel no route opens, settings tab names, an email
  on General, a first-load crash that recurs per route). Fixed in
  `433aea9`.
- run 2 (`433aea9`): F2 **passed**, 0 repairs, 0 blockers, about 3 min.
  Three text contradictions (screenshot names, the admin nav list, a
  stale raw-key note) fixed in `c88449a`, re-verified above.

App findings, filed to the inbox, not fixed here: the first visit to a
route can crash once with "Invalid hook call" until a reload (vite
re-optimises a late dependency); raw translation keys seen once after
that crash; `showDetail` in `admin.tsx` has no caller; four
accessibility findings on settings and admin.
