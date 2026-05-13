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
    hookTimeout: 30000,
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
