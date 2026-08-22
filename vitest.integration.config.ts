import { defineConfig } from "vitest/config"
import path from "path"

/**
 * Integration suite: tests that need real infrastructure alongside them.
 *
 * Kept out of the default config (which excludes `*.integration.test.ts`)
 * because these do not run on a laptop by default — they need the services the
 * `integration` CI job starts, and would otherwise fail for everyone with a
 * connection error that says nothing about their change.
 *
 * The one thing that made these necessary: duro-app shipped a release where
 * account creation could not work at all, because LldapClient posted to OPAQUE
 * routes LLDAP does not have. Every unit test passed — they mocked the very
 * HTTP layer that was wrong. Only a real LLDAP can catch that class of bug.
 *
 * No jsdom, no PGlite globalSetup, no coverage: this suite exists to exercise a
 * live protocol, and its slice of the codebase is already covered elsewhere.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Set here rather than in the test file: LldapClientLive reads these through
    // Effect.Config when its layer is built, and `test.env` is applied before
    // the test module (and therefore the client) is imported. Assigning them at
    // module scope would force a dynamic import and lose the client's types.
    env: {
      LLDAP_URL: process.env.LLDAP_URL ?? "http://localhost:17170",
      LLDAP_ADMIN_USER: process.env.LLDAP_ADMIN_USER ?? "admin",
      LLDAP_ADMIN_PASS: process.env.LLDAP_ADMIN_PASS ?? "ci-admin-password",
    },
    include: ["app/**/*.integration.test.ts"],
    // A real OPAQUE handshake runs Argon2id (m=19456, t=2) twice, and the
    // service container may still be warming when the first test starts.
    testTimeout: 60000,
    hookTimeout: 60000,
    // These talk to one shared LLDAP; parallel files would race on usernames.
    fileParallelism: false,
    retry: 0,
  },
  resolve: {
    alias: { "~": path.resolve(__dirname, "./app") },
  },
})
