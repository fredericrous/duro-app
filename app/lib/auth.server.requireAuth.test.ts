// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// requireAuth calls runEffect twice (cert lookup, then OIDC). Route both through
// the test runtime so the cert branch runs against a real (PGlite) DB and the
// OIDC branch resolves via OidcClientDev.
vi.mock("./runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect, runDbEffect: mod.testRunEffect }
})

const { requireAuth } = await import("./auth.server")
const { createSessionCookie } = await import("./session.server")
const { seedTestDb, truncateAll } = await import("~/test/test-runtime")

const FIXTURE_PEM = readFileSync(
  fileURLToPath(new URL("../test/fixtures/client-cert-fixture.pem", import.meta.url)),
  "utf8",
)
const XFCC = `Cert="${encodeURIComponent(FIXTURE_PEM)}"`

const seedPendingCert = () =>
  seedTestDb(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const expires = new Date(Date.now() + 86400_000).toISOString()
      yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at)
                 VALUES ('inv-1', 'token-1', 'hashed-token-1', 'alice@example.com', '[1]', '["family"]', 'admin', 'en', ${expires})`
      yield* sql`INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at)
                 VALUES ('cert-1', 'inv-1', NULL, 'alice', 'alice@example.com', '0a:1b:2c:3d:4e:5f', ${new Date().toISOString()}, ${expires})`
    }) as Effect.Effect<void, never, never>,
  )

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-must-be-32ch"
})
beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

const catchResponse = async (p: Promise<unknown>): Promise<Response> => {
  try {
    await p
    throw new Error("expected requireAuth to throw a redirect")
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

describe("requireAuth — pending-cert redirect", () => {
  it("sends an unauthenticated pending-invite cert straight to /setup", async () => {
    await seedPendingCert()
    const req = new Request("http://home.example/", { headers: { "x-forwarded-client-cert": XFCC } })
    const res = await catchResponse(requireAuth(req))
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/setup")
  })

  it("falls through to OIDC (not /setup) when no cert is presented", async () => {
    const req = new Request("http://home.example/dashboard")
    const res = await catchResponse(requireAuth(req))
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).not.toBe("/setup")
  })

  it("does not look at the cert when a valid session exists", async () => {
    await seedPendingCert() // present, but must be ignored
    const setCookie = await createSessionCookie({ sub: "abc", name: "alice", email: "alice@example.com", groups: [] })
    const req = new Request("http://home.example/", {
      headers: { cookie: setCookie.split(";")[0], "x-forwarded-client-cert": XFCC },
    })
    const auth = await requireAuth(req)
    expect(auth.user).toBe("alice")
  })
})

describe("requireAuth — a device presenting its user's revoked certificate", () => {
  const seedRevokedCert = (username: string) =>
    seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const expires = new Date(Date.now() + 86400_000).toISOString()
        yield* sql`INSERT INTO user_certificates (id, username, email, serial_number, issued_at, expires_at, revoked_at)
                   VALUES ('cert-1', ${username}, 'x@example.com', '0a:1b:2c:3d:4e:5f', ${new Date().toISOString()},
                           ${expires}, '2026-09-23T16:22:23Z')`
      }) as Effect.Effect<void, never, never>,
    )

  /** A signed-in request from alice's device, which presents the fixture cert. */
  const aliceRequest = async (path: string, init: RequestInit = {}) => {
    const setCookie = await createSessionCookie({ sub: "abc", name: "alice", email: "alice@example.com", groups: [] })
    return new Request(`http://home.example${path}`, {
      ...init,
      headers: { cookie: setCookie.split(";")[0], "x-forwarded-client-cert": XFCC },
    })
  }

  it("sends any page but /devices to /devices", async () => {
    await seedRevokedCert("alice")
    for (const path of ["/", "/settings", "/admin", "/catalog.data"]) {
      const res = await catchResponse(requireAuth(await aliceRequest(path)))
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toBe("/devices")
    }
  })

  it("refuses any other write with 403", async () => {
    await seedRevokedCert("alice")
    const res = await catchResponse(requireAuth(await aliceRequest("/settings", { method: "POST" })))
    expect(res.status).toBe(403)
  })

  it("lets /devices and its data and writes through", async () => {
    await seedRevokedCert("alice")
    expect((await requireAuth(await aliceRequest("/devices"))).user).toBe("alice")
    expect((await requireAuth(await aliceRequest("/devices.data"))).user).toBe("alice")
    expect((await requireAuth(await aliceRequest("/devices", { method: "POST" }))).user).toBe("alice")
  })

  it("leaves a device alone when the revoked certificate is another user's", async () => {
    await seedRevokedCert("bob")
    expect((await requireAuth(await aliceRequest("/settings"))).user).toBe("alice")
  })
})
