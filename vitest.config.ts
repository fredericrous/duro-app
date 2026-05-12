import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
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
      // Coverage floor — locks in current progress so future PRs can't drop
      // below it. Pegged just under the present numbers (46% lines / 33% br)
      // to leave headroom for honest refactors that temporarily dip. Ratchet
      // these UP as more tests land — every PR should be allowed to raise
      // the floor, never lower it.
      //
      // Original target was 80% lines; reaching it requires component-render
      // tests (Header, AppOverview, dialog forms, etc.) and Live-variant
      // service tests (EmailService SMTP, OidcClient discovery). Tracked as
      // follow-up; the test-runtime helpers in app/test make those tractable.
      thresholds: {
        lines: 45,
        statements: 44,
        functions: 38,
        branches: 32,
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
})
