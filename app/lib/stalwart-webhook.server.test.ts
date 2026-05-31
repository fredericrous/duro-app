// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  computeSignature,
  verifySignature,
  statusForEventType,
  inviteIdFromMessageId,
  parseDeliveryUpdates,
} from "./stalwart-webhook.server"

const KEY = "test-signing-key"

describe("verifySignature", () => {
  const body = JSON.stringify({ events: [] })

  it("accepts a correct HMAC-SHA256 base64 signature", () => {
    const sig = computeSignature(body, KEY)
    expect(verifySignature(body, sig, KEY)).toBe(true)
  })

  it("rejects a wrong signature", () => {
    expect(verifySignature(body, computeSignature(body, "other-key"), KEY)).toBe(false)
    expect(verifySignature(body, "bm90LWFzaWc=", KEY)).toBe(false)
  })

  it("rejects a missing/empty signature without throwing", () => {
    expect(verifySignature(body, null, KEY)).toBe(false)
    expect(verifySignature(body, "", KEY)).toBe(false)
  })

  it("is sensitive to body tampering", () => {
    const sig = computeSignature(body, KEY)
    expect(verifySignature(body + " ", sig, KEY)).toBe(false)
  })
})

describe("statusForEventType", () => {
  it("maps delivered events", () => {
    expect(statusForEventType("delivery.delivered")).toBe("delivered")
    expect(statusForEventType("delivery.dsn-success")).toBe("delivered")
  })

  it("maps permanent failures to bounced", () => {
    for (const t of [
      "delivery.rcpt-to-rejected",
      "delivery.message-rejected",
      "delivery.null-mx",
      "delivery.mx-lookup-failed",
      "delivery.dsn-perm-fail",
    ]) {
      expect(statusForEventType(t)).toBe("bounced")
    }
  })

  it("maps transient failures to deferred — delivery.failed is NOT a bounce", () => {
    expect(statusForEventType("delivery.failed")).toBe("deferred")
    expect(statusForEventType("delivery.connect-error")).toBe("deferred")
    expect(statusForEventType("delivery.rate-limit-exceeded")).toBe("deferred")
    expect(statusForEventType("delivery.dsn-temp-fail")).toBe("deferred")
  })

  it("ignores unrelated events", () => {
    expect(statusForEventType("auth.success")).toBeNull()
    expect(statusForEventType("delivery.attempt-start")).toBeNull()
    expect(statusForEventType("queue.rescheduled")).toBeNull()
  })
})

describe("inviteIdFromMessageId", () => {
  it("extracts the invite id from our deterministic Message-ID", () => {
    expect(inviteIdFromMessageId("<invite-abc-123@daddyshome.fr>")).toBe("abc-123")
    expect(inviteIdFromMessageId("invite-xyz@daddyshome.fr")).toBe("xyz")
  })
  it("returns null for foreign / missing Message-IDs", () => {
    expect(inviteIdFromMessageId("<random@example.com>")).toBeNull()
    expect(inviteIdFromMessageId(null)).toBeNull()
  })
})

describe("parseDeliveryUpdates", () => {
  it("parses delivered + bounced events and extracts correlation fields", () => {
    const updates = parseDeliveryUpdates({
      events: [
        {
          type: "delivery.delivered",
          data: { messageId: "<invite-inv-1@daddyshome.fr>", to: "Alice@Example.com", response: "250 OK" },
        },
        {
          type: "delivery.rcpt-to-rejected",
          data: { rcptTo: "bob@example.com", reason: "550 No such user" },
        },
      ],
    })

    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({
      status: "delivered",
      inviteId: "inv-1",
      messageId: "<invite-inv-1@daddyshome.fr>",
      recipient: "alice@example.com", // lowercased
      detail: "250 OK",
    })
    expect(updates[1]).toMatchObject({
      status: "bounced",
      inviteId: null,
      recipient: "bob@example.com",
      detail: "550 No such user",
    })
  })

  it("drops non-delivery events and tolerates unknown/empty data", () => {
    const updates = parseDeliveryUpdates({
      events: [
        { type: "auth.success", data: {} },
        { type: "delivery.failed", data: {} }, // deferred, no correlation fields
        { type: "delivery.delivered" }, // missing data entirely
        "garbage",
        null,
      ],
    })
    // delivery.failed (deferred) + delivery.delivered survive; auth.success dropped
    expect(updates.map((u) => u.status)).toEqual(["deferred", "delivered"])
    expect(updates[0].recipient).toBeNull()
    expect(updates[0].messageId).toBeNull()
  })

  it("returns [] for a malformed payload", () => {
    expect(parseDeliveryUpdates({})).toEqual([])
    expect(parseDeliveryUpdates({ events: "nope" })).toEqual([])
    expect(parseDeliveryUpdates(null)).toEqual([])
  })

  // Mirrors the REAL v0.15.5 delivery event shape (crates/smtp/src/outbound/
  // session.rs): PascalCase keys To/Details/Hostname/Code, and crucially NO
  // message-id. Correlation must work off the recipient alone, case-insensitively.
  it("handles the real Stalwart delivery shape (PascalCase keys, no message-id)", () => {
    const updates = parseDeliveryUpdates({
      events: [
        {
          type: "delivery.delivered",
          data: { SpanId: "s1", Hostname: "mx.example.com", To: "Carol@Example.com", Code: 250, Details: "250 OK" },
        },
        {
          type: "delivery.rcpt-to-rejected",
          data: { Hostname: "mx.example.com", To: "dave@example.com", Code: 550, Details: "550 5.1.1 unknown" },
        },
      ],
    })

    expect(updates[0]).toMatchObject({
      status: "delivered",
      inviteId: null, // no message-id on real delivery events
      messageId: null,
      recipient: "carol@example.com",
      detail: "250 OK",
    })
    expect(updates[1]).toMatchObject({ status: "bounced", recipient: "dave@example.com", detail: "550 5.1.1 unknown" })
  })
})
