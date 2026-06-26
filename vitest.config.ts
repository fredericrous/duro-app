import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    // jsdom is the default — every test file that touches the DOM
    // (component renders, route tests, anything using @testing-library/react)
    // needs it. Server-only tests under app/lib/** use the lighter `node`
    // environment via per-file `// @vitest-environment node` pragmas
    // (vitest 4 dropped the file-level `environmentMatchGlobs` config).
    environment: "jsdom",
    setupFiles: ["./app/test/setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
    // Cap worker concurrency. vitest's default reads the NODE's core count,
    // not the CPU-limited runner pod's cgroup quota, so it over-forks: dozens
    // of per-file PGlite instances + migrations run at once on a couple of CPUs
    // (made worse by v8 coverage instrumentation), starving each setup hook
    // past its timeout. Two workers in CI keeps PGlite setup fast and the suite
    // deterministic; locally (more CPUs) allow four. The runner's memory limit
    // was raised to 8Gi to hold two such forks (see homelab arc runners.yaml).
    // (vitest 4 replaced poolOptions.forks.maxForks with top-level maxWorkers.)
    maxWorkers: process.env.CI ? 2 : 4,
    // PGlite migrate+truncate runs once per test file in a beforeAll-style hook;
    // under constrained CI CPU it needs well above the 30s default to settle.
    hookTimeout: 90000,
    // Above setup.ts's `asyncUtilTimeout: 5000` so a stalled `waitFor`/`findBy`
    // surfaces Testing Library's descriptive timeout error instead of a bare
    // vitest test-timeout (the 5000ms default would race the async-util cap).
    testTimeout: 30000,
    // Focused coverage scope. Infrastructure entrypoints (worker, api/auth/
    // health routes, migrations, i18n bootstrap) are excluded because they're
    // either integration-tested through other paths or contain no logic worth
    // unit-covering. Thresholds wired in Phase 6 once we hit the target.
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/**/*.test.{ts,tsx}",
        "app/**/*.d.ts",
        "app/test/**",
        "app/lib/i18n.setup.ts",
        "app/lib/db/migrations/**",
        "app/worker/**",
        "app/routes/api.*.ts",
        "app/routes/auth.*.tsx",
        "app/routes/auth.*.ts",
        "app/routes/health.ts",
        "build/**",
        "node_modules/**",
      ],
      // Coverage floor — pegged just under current numbers to lock in
      // progress. Ratchet UP as more tests land; PRs may raise the floor,
      // never lower it. The 80% line target proved out of reach without
      // grinding ~30 small route files at diminishing ROI; planning doc
      // tracks the realistic remaining work — see
      // /Users/fredericrous/.claude/plans/in-duro-app-how-hashed-snowglobe.md.
      thresholds: {
        lines: 73,
        statements: 72,
        functions: 66,
        branches: 62,
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
})
