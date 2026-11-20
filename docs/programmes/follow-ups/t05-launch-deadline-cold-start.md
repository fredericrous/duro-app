+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

2026-11-20: the deadline was the cause; a probe that times out costs
nothing. A start is a fixed amount of CPU work, and its wall time is that
work over the CPU the machine leaves.

- Probes: paired cold starts, 5 s probes against one 300 s probe, reached
  ready at the same time: 32 and 33 s, 33 and 29 s at load 9; 172 and
  168 s at load 220. The aborted requests do not slow the compile.
- CPU to ready, from `ps -g <pgid>`, cold and warm alternating: cold
  74.9, 74.9, 73.9 CPU-s; warm (`node_modules/.vite` kept) 52.8, 46.2,
  45.5. Wall time to ready: 111 s cold at load 29 (it climbed to 104
  during the run), 70 s warm at 104, 40-72 s at 40-70, 32-42 s at 23-27.
  So a cold worktree adds about 25 CPU-s (the dep optimizer's first run;
  which part of it was not isolated), and load, not coldness, decides whether 120 s is enough.
- An idle, ready server gains 0-1.2 CPU-s in 30 s; a loaded cold start
  gains about 13.
- Fix: Launch has no fixed deadline. It waits while the server group
  gains at least 2 CPU-s in each 30 s window, fails as `stalled`
  otherwise, and stops at 450 s: one more wait pass (up to 105 s) and
  the teardown still end under the Bash tool's 600 s ceiling. The
  skill says to run Launch with the tool timeout at 600000 ms. The "seen
  twice" note is replaced: vite's `Local:` line with no request served is
  a compile in progress.

Checks: cold Launches were ready in 35 s at load 24 and 82 s at load
39, then Doctor and Cleanup passed; the group kept the same 2 members
throughout. With the server group frozen by SIGSTOP 6 s in, Launch
failed `stalled` at 42 and 44 s and left no group member or pidfile. The unit
tests (`scripts/test_verify.py`, python 3.9 and 3.15) cover the
`ps` time parse, the stall rule (a member exiting is not a stall) and
the cap budget, and fail on the old code. `ps -S` keeps a reaped
child's CPU in the group sum.
