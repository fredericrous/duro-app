+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

Task, 2026-11-20. Fixed on `fix/first-visit-dep-scan`.

- **Cause, two parts, each enough alone:**
  - `@react-router/dev` gives vite's dependency scan no entries unless
    `future.unstable_optimizeDeps` is set, so vite pre-bundled only
    React and found the other 22 client dependencies (`@duro-app/ui`,
    `react-i18next`, `effect`, …) on the first browser visit, and
    `@duro-app/tokens/tokens/breakpoints.css` on the first `/admin`.
  - vite-plugin-babel 1.6.0 hooks the app rule into the scan's esbuild
    run and returns babel's output (JSX kept) with no loader, so esbuild
    read it as `js`, and the scan failed on 80 component files ("The JSX
    syntax extension is not currently enabled"), silently.
  - The late find re-bundled React under a new hash while the page held
    the old copy: "Invalid hook call", then vite's reload.
- **Fix:** `future.unstable_optimizeDeps: true` in
  `react-router.config.ts` (it takes its entries from `routes.ts`; an
  `app/routes/**` glob in `vite.config.ts` would also scan the 46
  colocated tests) and `loader: "jsx"` on the app babel rule. Removing
  either one brought the crash back.
- **Loop:** cold `node_modules/.vite`, dev server with Launch's
  environment, headless first visits to the detail route, `/catalog`,
  `/admin`, `/settings` and `/`. Red on every route before (and on any
  "optimized dependencies changed" line), green twice after, with 0
  scan errors and 44 dependencies pre-bundled at startup instead of 7.
  `browser-check` on the verify skill's Launch confirmed it.
- **Seam:** none in the test suites. It needs a cold dev-server boot
  (30-100 s here). The verify skill now counts any "Invalid hook call"
  as a defect, which makes each verify run the check.
- **Verify skill:** the reload-once gotcha is gone from the four feature
  files and the brief.
- **Filed:** [t05](t05-launch-deadline-cold-start.md),
  [t06](t06-server-packages-in-client-graph.md),
  [t07](t07-duplicate-family-group.md).
