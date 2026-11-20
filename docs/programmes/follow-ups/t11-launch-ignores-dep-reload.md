+++
type = "task"
mode = "afk"
status = "open"
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
