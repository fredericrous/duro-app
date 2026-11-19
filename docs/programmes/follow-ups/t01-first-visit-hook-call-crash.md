+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Why the first visit to a route crashes once in dev

## Question

On a fresh dev server, the first browser visit to some routes (seen on
`/catalog` and `/admin/applications/<id>`, 2026-11-19) renders
"Application Error!" with "Invalid hook call" and "Cannot read
properties of null (reading 'useContext')" at `Layout` (`app/root.tsx`),
and a reload fixes it. Is it vite re-optimising a client dependency it
found late (two copies of React), and what stops it?

## Look at

- `vite.config.ts`: `optimizeDeps` (`include`, `entries`) and
  `server.warmup`; the server log for "new dependencies optimized" and
  "reloading" around the first visit.
- Reproduce with `.claude/skills/verify-duro-app`: Launch, then
  `brief … admin` to `browser-check` in a fresh isolated context.

## Answer looks like

The dependency that is found late, a `vite.config.ts` change that makes
the first visit to every route render, and the verify skill's
first-visit gotcha removed in the same PR.
