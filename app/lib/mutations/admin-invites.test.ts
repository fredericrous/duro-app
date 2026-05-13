// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { handleAdminInvitesMutation, parseAdminInvitesMutation } from "./admin-invites"
import { seedTestDb, testRunEffect, truncateAll } from "~/test/test-runtime"

beforeEach(async () => {
  await truncateAll()
})

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item)
    else f.append(k, v)
  }
  return f
}

// =============================================================================
// parseAdminInvitesMutation
// =============================================================================

describe("parseAdminInvitesMutation", () => {
  it("parses revoke with inviteId", () => {
    expect(parseAdminInvitesMutation(fd({ intent: "revoke", inviteId: "inv-1" }))).toEqual({
      intent: "revoke",
      inviteId: "inv-1",
    })
  })

  it("rejects revoke / retry / resend without inviteId", () => {
    for (const intent of ["revoke", "retry", "resend"] as const) {
      expect(parseAdminInvitesMutation(fd({ intent }))).toEqual({ error: "Missing invite ID" })
    }
  })

  it("parses retry / resend with inviteId", () => {
    expect(parseAdminInvitesMutation(fd({ intent: "retry", inviteId: "inv-1" }))).toEqual({
      intent: "retry",
      inviteId: "inv-1",
    })
    expect(parseAdminInvitesMutation(fd({ intent: "resend", inviteId: "inv-1" }))).toEqual({
      intent: "resend",
      inviteId: "inv-1",
    })
  })

  it("parses send with multi-email free-text (newlines/commas/semis)", () => {
    const result = parseAdminInvitesMutation(
      fd({
        emails: "alice@example.com, bob@example.com\ncarol@example.com; dave@example.com",
        groups: ["1|family", "2|media"],
        locale: "fr",
      }),
    )
    expect(result).toEqual({
      intent: "send",
      emails: ["alice@example.com", "bob@example.com", "carol@example.com", "dave@example.com"],
      groups: ["1|family", "2|media"],
      locale: "fr",
      confirmed: false,
      revocationId: undefined,
    })
  })

  it("filters out malformed emails (no @-sign)", () => {
    const result = parseAdminInvitesMutation(
      fd({
        emails: "alice@example.com\nnot-an-email\nbob@example.com",
        groups: ["1|family"],
      }),
    )
    expect((result as { emails: string[] }).emails).toEqual(["alice@example.com", "bob@example.com"])
  })

  it("uses hidden-input semantics when 'emails' has multiple entries", () => {
    const result = parseAdminInvitesMutation(
      fd({
        emails: ["alice@example.com", "bob@example.com"],
        groups: ["1|family"],
      }),
    )
    expect((result as { emails: string[] }).emails).toEqual(["alice@example.com", "bob@example.com"])
  })

  it("defaults locale to 'en' when not provided", () => {
    const result = parseAdminInvitesMutation(fd({ emails: "alice@example.com", groups: ["1|family"] }))
    expect((result as { locale: string }).locale).toBe("en")
  })

  it("parses confirmed=true and revocationId together", () => {
    const result = parseAdminInvitesMutation(
      fd({
        emails: "alice@example.com",
        groups: ["1|family"],
        confirmed: "true",
        revocationId: "rev-1",
      }),
    )
    expect(result).toMatchObject({ confirmed: true, revocationId: "rev-1" })
  })

  it("rejects send with no valid emails", () => {
    expect(parseAdminInvitesMutation(fd({ emails: "garbage", groups: ["1|family"] }))).toEqual({
      error: "At least one valid email is required",
    })
  })

  it("rejects send with no groups", () => {
    expect(parseAdminInvitesMutation(fd({ emails: "alice@example.com" }))).toEqual({
      error: "Select at least one group",
    })
  })
})

// =============================================================================
// handleAdminInvitesMutation — exercised against a real DB
// =============================================================================

const seedRevokedEmail = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO user_revocations (id, email, username, revoked_by, reason)
             VALUES ('rev-1', 'alice@example.com', 'alice', 'admin', 'GDPR')`
})

describe("handleAdminInvitesMutation — send revocation prompt", () => {
  it("returns the 'previously revoked' warning instead of sending (single email + unconfirmed)", async () => {
    await seedTestDb(seedRevokedEmail)

    const result = await testRunEffect(
      handleAdminInvitesMutation({
        intent: "send",
        emails: ["alice@example.com"],
        groups: ["1|family"],
        locale: "en",
        confirmed: false,
      }),
    )

    expect("warning" in result).toBe(true)
    if ("warning" in result) {
      expect(result.warning).toContain("previously revoked by admin")
      expect(result.warning).toContain("GDPR")
      expect(result.revocationId).toBe("rev-1")
      expect(result.emails).toEqual(["alice@example.com"])
    }
  })

  it("does NOT show the revocation prompt when sending to multiple addresses (single-email-only guard)", async () => {
    await seedTestDb(seedRevokedEmail)

    const result = await testRunEffect(
      handleAdminInvitesMutation({
        intent: "send",
        emails: ["alice@example.com", "bob@example.com"],
        groups: ["1|family"],
        locale: "en",
        confirmed: false,
      }),
    )
    // No warning shape — the multi-email path falls through.
    expect("warning" in result).toBe(false)
  })

  it("clears the revocation row when confirmed=true + revocationId is provided", async () => {
    await seedTestDb(seedRevokedEmail)

    await testRunEffect(
      handleAdminInvitesMutation({
        intent: "send",
        emails: ["alice@example.com"],
        groups: ["1|family"],
        locale: "en",
        confirmed: true,
        revocationId: "rev-1",
      }),
    )

    const remaining = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`SELECT id FROM user_revocations`
        return rows
      }),
    )
    expect(remaining).toHaveLength(0)
  })
})

describe("handleAdminInvitesMutation — retry/resend", () => {
  it("returns 'Invite not found' (as error shape, not throw) when inviteId is unknown", async () => {
    const result = await testRunEffect(handleAdminInvitesMutation({ intent: "retry", inviteId: "does-not-exist" }))
    expect(result).toEqual({ error: "Invite not found" })
  })
})
