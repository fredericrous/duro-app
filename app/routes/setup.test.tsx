// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", homeUrl: "https://duro.example.com", inviteBaseUrl: "https://join.example.com" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { action, loader } from "./setup"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData } from "~/test/route-utils"

// Fixture cert canonicalizes to serial "a1b2c3d4e5f"; store its Vault colon-form.
const FIXTURE_PEM = readFileSync(
  fileURLToPath(new URL("../test/fixtures/client-cert-fixture.pem", import.meta.url)),
  "utf8",
)
const XFCC = `Cert="${encodeURIComponent(FIXTURE_PEM)}"`
const STORED_SERIAL = "0a:1b:2c:3d:4e:5f"

const seedInviteAndCert = (
  opts: { userId?: string | null; usedAt?: string | null; usedBy?: string | null; expiresAt?: string } = {},
) =>
  seedTestDb(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const expires = opts.expiresAt ?? new Date(Date.now() + 86400_000).toISOString()
      yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at, used_at, used_by)
                 VALUES ('inv-1', 'token-1', 'hashed-token-1', 'alice@example.com', '[1]', '["family"]', 'admin', 'en',
                         ${expires}, ${opts.usedAt ?? null}, ${opts.usedBy ?? null})`
      yield* sql`INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at)
                 VALUES ('cert-1', 'inv-1', ${opts.userId ?? null}, 'alice', 'alice@example.com', ${STORED_SERIAL},
                         ${new Date().toISOString()}, ${expires})`
    }) as Effect.Effect<void, never, never>,
  )

beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

describe("/setup loader", () => {
  it("returns no_cert when no client cert is presented", async () => {
    const data = expectData<{ valid: boolean; error?: string }>(await callLoader(loader, {}))
    expect(data.valid).toBe(false)
    expect(data.error).toBe("no_cert")
  })

  it("shows the form for a pending invite bound to the presented cert", async () => {
    await seedInviteAndCert()
    const data = expectData<{ valid: boolean; email?: string }>(
      await callLoader(loader, { headers: { "x-forwarded-client-cert": XFCC } }),
    )
    expect(data.valid).toBe(true)
    expect(data.email).toBe("alice@example.com")
  })

  it("redirects to the app when the cert already has an account", async () => {
    await seedInviteAndCert({ userId: "alice", usedAt: new Date().toISOString(), usedBy: "alice" })
    const result = await callLoader(loader, { headers: { "x-forwarded-client-cert": XFCC } })
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(302)
  })

  it("errors for an expired invite", async () => {
    await seedInviteAndCert({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const data = expectData<{ valid: boolean; error?: string }>(
      await callLoader(loader, { headers: { "x-forwarded-client-cert": XFCC } }),
    )
    expect(data.valid).toBe(false)
    expect(data.error).toBe("expired")
  })
})

describe("/setup action", () => {
  it("rejects when the request origin is not allowed", async () => {
    const { isOriginAllowed } = await import("~/lib/config.server")
    vi.mocked(isOriginAllowed).mockReturnValueOnce(false)
    const data = expectData<{ error?: string }>(
      await callAction(action, {
        formData: { username: "alice", password: "longenoughpw1", confirmPassword: "longenoughpw1" },
      }),
    )
    expect(data.error).toBe("invalid_origin")
  })

  it("creates the account for a pending cert and reports success", async () => {
    await seedInviteAndCert()
    const data = expectData<{ success?: boolean }>(
      await callAction(action, {
        headers: { "x-forwarded-client-cert": XFCC },
        formData: { username: "alice", password: "longenoughpw1", confirmPassword: "longenoughpw1" },
      }),
    )
    expect(data.success).toBe(true)
  })

  it("caps repeated attempts on the same invite", async () => {
    await seedInviteAndCert()
    // Bump attempts to the cap directly.
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE invites SET attempts = 5 WHERE id = 'inv-1'`
      }) as Effect.Effect<void, never, never>,
    )
    const data = expectData<{ valid: boolean; error?: string }>(
      await callLoader(loader, { headers: { "x-forwarded-client-cert": XFCC } }),
    )
    expect(data.valid).toBe(false)
    expect(data.error).toBe("too_many_attempts")
  })
})
