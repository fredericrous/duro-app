+++
type = "task"
mode = "afk"
status = "closed"
blocked_by = []
repos = ["duro-app"]
+++

# Launch passes while vite re-bundles dependencies

## Question

During t06, verify-duro-app Launch reported ready while its server log
held "optimized dependencies changed. reloading", the line that comes
before t01's "Invalid hook call" crash. Should Launch, Doctor or Drive
fail on it, and at which point is the log final enough to read?

## Look at

- `.claude/skills/verify-duro-app/scripts/verify.py`: readiness and the
  server log copy in `drive`.
- Reproduce by making the scan skip a dependency (t06's Experiment) and
  running Launch, then `drive … admin`.

## Answer looks like

A verify step that fails with the log line quoted when vite re-bundles
after the start, a test in `test_verify.py`, and a clean run on HEAD.

## Resolution

2026-11-20: Launch, Doctor and Drive each fail on the line, quoted, and
read the log once the server group is quiet, not at a fixed point.

- When it appears: with t06's experiment back (the scan skips `.server`
  imports), 3 of 3 cold Launches (no `node_modules/.vite`, load 9-14)
  logged `optimized dependencies changed. reloading` about 1 s after
  Launch reported ready, at 26-29 s, and none at the moment of ready. No
  page request is needed: the ready probe's render of `/` finds the
  missed imports. Two warm Launches logged nothing: the first cold run
  had cached the late deps. So a check at ready alone misses it every
  time, and only a cold run proves the scan.
- Fix: after ready, Launch waits until the group gains under 0.3 CPU-s
  in 3 s (an idle server gains about 0.04 a second), at most 30 s, then
  fails as a miss when the log holds the line. The 30 s comes out of
  the cap (450 s to 410 s), so a capped Launch still tears down under
  the tool's 600 s. Doctor and Drive do the same after their own
  requests, since any request can find a missed import; the skill says
  to run Drive after the browser-check agents so it covers their visits.
  A lone `new dependencies optimized` line reloads nothing and passes.

Checks: on the repro config, a cold Launch failed at 38 s with the line
quoted and left no pidfile. On HEAD's config, cold at load 6, the
committed tree's Launch was ready in 30 s, Doctor passed in 4 s, Drive
(four journeys) in 5 s, Cleanup passed, and the copied log held 0
reload lines: each settle costs about 3 s on an idle server. With the line appended
to a live server's log by hand, Doctor (passing just before) and
Drive failed, Drive naming its evidence copy of the log.
`scripts/test_verify.py` (12 tests, python 3.9.6 and 3.15.2) covers the
line match, the quiet window and the cap.
