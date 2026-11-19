+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Why verify-duro-app Launch times out on a cold worktree

## Question

On 2026-11-20 Launch missed its 120 s deadline 3 of 3 times on a fresh
worktree: the first `/health/ready` took 50 to 100 s, with 5 s probes, while
the load average was about 36 on 12 cores. A later run answered in 30 s.
Is the deadline too short for a cold start on this machine, or does a
probe that times out slow the start down?

## Look at

- `not_ready` and the deadline in
  `.claude/skills/verify-duro-app/scripts/verify.py`.
- The time to the first `/health/ready` on a cold worktree, idle and
  under load, several runs each.

## Answer looks like

A deadline sized from the measured cold starts, or a probe that waits
for the first compile, with the skill's "seen twice" note replaced.
