// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

// Run the route's runEffect against the REAL test runtime (PGlite + Live
// InviteRepo) instead of a stub — the webhook is exercised end-to-end:
// signed POST → action → Effect → SQL, asserting the actual invite row.
vi.mock("~/lib/runtime.server", async () => {
  const { testRunEffect } = await import("~/test/test-runtime")
  return { runEffect: testRunEffect }
})

import { Effect } from "effect"
import { action } from "./api.stalwart.delivery"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { computeSignature } from "~/lib/stalwart-webhook.server"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, expectData } from "~/test/route-utils"

const KEY = "unit-test-key"

function post(body: string, sig?: string) {
  return new Request("http://localhost/api/stalwart/delivery", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig ?? computeSignature(body, KEY) },
    body,
  })
}

const seedInvite = (email: string) =>
  seedTestDb(
    Effect.gen(function* () {
      const repo = yield* InviteRepo
      const { id } = yield* repo.create({ email, groups: [1], groupNames: ["friends"], invitedBy: "admin" })
      yield* repo.setMessageId(id, `<invite-${id}@daddyshome.fr>`)
      return id
    }),
  )

const getInvite = (id: string) =>
  seedTestDb(
    Effect.gen(function* () {
      const repo = yield* InviteRepo
      return yield* repo.findById(id)
    }),
  )

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.WEBHOOK_SIGNATURE_KEY = KEY
  await truncateAll()
})
afterEach(() => {
  delete process.env.WEBHOOK_SIGNATURE_KEY
})

describe("/api/stalwart/delivery (end-to-end against PGlite)", () => {
  it("rejects a bad signature with 401 and leaves the invite untouched", async () => {
    const id = await seedInvite("a@x.com")
    const body = JSON.stringify({ events: [{ type: "delivery.delivered", data: { to: "a@x.com" } }] })

    const res = expectData<Response>(await callAction(action, { request: post(body, "d3Jvbmc=") }))
    expect(res.status).toBe(401)
    expect((await getInvite(id))!.deliveryStatus).toBeNull()
  })

  it("503 when the signing key isn't configured", async () => {
    delete process.env.WEBHOOK_SIGNATURE_KEY
    const res = expectData<Response>(await callAction(action, { request: post("{}") }))
    expect(res.status).toBe(503)
  })

  it("correlates a delivered event by recipient (real Stalwart shape: To/Details, no message-id)", async () => {
    const id = await seedInvite("alice@example.com")
    // Exactly what v0.15.5 emits for delivery.delivered — PascalCase, no message-id.
    const body = JSON.stringify({
      events: [
        {
          type: "delivery.delivered",
          data: { Hostname: "mx.example.com", To: "alice@example.com", Code: 250, Details: "250 OK" },
        },
      ],
    })

    const res = expectData<Response>(await callAction(action, { request: post(body) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, applied: 1 })

    const inv = await getInvite(id)
    expect(inv!.deliveryStatus).toBe("delivered")
    expect(inv!.deliveredAt).not.toBeNull()
  })

  it("still uses Message-ID when a payload happens to carry one (cascade)", async () => {
    const id = await seedInvite("carol@example.com")
    // If a future/enriched payload includes our Message-ID, correlate by it directly.
    const body = JSON.stringify({
      events: [{ type: "delivery.delivered", data: { messageId: `<invite-${id}@daddyshome.fr>`, Details: "250 OK" } }],
    })
    expectData<Response>(await callAction(action, { request: post(body) }))
    expect((await getInvite(id))!.deliveryStatus).toBe("delivered")
  })

  it("correlates a bounce by recipient email (no Message-ID) and records the reason", async () => {
    const id = await seedInvite("bob@example.com")
    const body = JSON.stringify({
      events: [{ type: "delivery.rcpt-to-rejected", data: { to: "BOB@example.com", reason: "550 No such user" } }],
    })

    const res = expectData<Response>(await callAction(action, { request: post(body) }))
    expect(res.status).toBe(200)

    const inv = await getInvite(id)
    expect(inv!.deliveryStatus).toBe("bounced")
    expect(inv!.deliveryDetail).toBe("550 No such user")
  })

  it("returns 200 with applied:0 for an unmatched recipient (no crash)", async () => {
    const body = JSON.stringify({
      events: [{ type: "delivery.delivered", data: { to: "nobody@nowhere.com" } }],
    })
    const res = expectData<Response>(await callAction(action, { request: post(body) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, applied: 0 })
  })

  it("ignores non-delivery events (applied:0)", async () => {
    const body = JSON.stringify({ events: [{ type: "auth.success", data: {} }] })
    const res = expectData<Response>(await callAction(action, { request: post(body) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, applied: 0 })
  })

  it("rejects non-POST with 405", async () => {
    const res = expectData<Response>(
      await callAction(action, { request: new Request("http://localhost/api/stalwart/delivery", { method: "GET" }) }),
    )
    expect(res.status).toBe(405)
  })
})
