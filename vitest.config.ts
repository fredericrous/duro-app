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
      // Coverage floor — pegged just under current numbers to lock in
      // progress. Ratchet UP as more tests land; PRs may raise the floor,
      // never lower it. Target is 80% lines; the remaining gap is mostly
      // PluginHost.server.ts, ProvisioningService.server.ts, and a few
      // route variants (admin.users dialogs, admin.applications dialogs).
      thresholds: {
        lines: 65,
        statements: 64,
        functions: 60,
        branches: 55,
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
})
