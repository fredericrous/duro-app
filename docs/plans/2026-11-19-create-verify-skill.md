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

Filled in at F3.
