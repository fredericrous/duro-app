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
      delivery: "email",
    })
  })

  it("defaults delivery to 'email' and accepts an explicit 'link'", () => {
    const base = { emails: "alice@example.com", groups: ["1|family"] }
    expect(parseAdminInvitesMutation(fd(base))).toMatchObject({ delivery: "email" })
    expect(parseAdminInvitesMutation(fd({ ...base, delivery: "email" }))).toMatchObject({ delivery: "email" })
    expect(parseAdminInvitesMutation(fd({ ...base, delivery: "link" }))).toMatchObject({ delivery: "link" })
  })

  it("rejects an unknown delivery rather than silently emailing", () => {
    expect(
      parseAdminInvitesMutation(fd({ emails: "alice@example.com", groups: ["1|family"], delivery: "carrier-pigeon" })),
    ).toEqual({ error: "Unsupported delivery" })
  })

  it("rejects a link invite addressed to more than one email", () => {
    // One QR code carries one token; batching would hand everyone Alice's.
    expect(
      parseAdminInvitesMutation(
        fd({ emails: "alice@example.com, bob@example.com", groups: ["1|family"], delivery: "link" }),
      ),
    ).toEqual({ error: "A QR code can only be generated for one email at a time" })
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
        delivery: "email" as const,
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
        delivery: "email" as const,
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
        delivery: "email" as const,
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

// =============================================================================
// handleAdminInvitesMutation — showing an existing invite's QR code again
// =============================================================================

const seedPendingInvite = (expiresInMs = 86400_000) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const expires = new Date(Date.now() + expiresInMs).toISOString()
    yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at)
               VALUES ('inv-1', 'token-1', 'hashed-token-1', 'alice@example.com', '[1]', '["family"]', 'admin', 'en', ${expires})`
  })

describe("handleAdminInvitesMutation — showLink", () => {
  it("hands back the pending invite's link: same token, nothing re-issued", async () => {
    await seedTestDb(seedPendingInvite())
    const result = await testRunEffect(handleAdminInvitesMutation({ intent: "showLink", inviteId: "inv-1" }))
    expect("success" in result && result.invite).toBeTruthy()
    if ("success" in result && result.invite) {
      expect(result.invite.url).toMatch(/\/invite\/token-1$/)
      expect(result.invite.email).toBe("alice@example.com")
    }
  })

  it("refuses once the invite is no longer pending", async () => {
    await seedTestDb(seedPendingInvite(-1000))
    const expired = await testRunEffect(handleAdminInvitesMutation({ intent: "showLink", inviteId: "inv-1" }))
    expect(expired).toEqual({ error: "Invite is no longer pending" })
    const unknown = await testRunEffect(handleAdminInvitesMutation({ intent: "showLink", inviteId: "nope" }))
    expect(unknown).toEqual({ error: "Invite is no longer pending" })
  })

  it("treats a second QR request for an already-invited address as 'show it again'", async () => {
    // Used to fail with "Pending invite already exists" and leave the admin
    // with no way back to the code.
    await seedTestDb(seedPendingInvite())
    const result = await testRunEffect(
      handleAdminInvitesMutation({
        intent: "send",
        emails: ["alice@example.com"],
        groups: ["1|family"],
        locale: "en",
        confirmed: false,
        delivery: "link" as const,
      }),
    )
    expect("success" in result && result.invite?.url).toMatch(/\/invite\/token-1$/)

    const rows = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ id: string }>`SELECT id FROM invites WHERE email = 'alice@example.com'`
      }),
    )
    expect(rows).toHaveLength(1)
  })

  it("parses showLink with inviteId", () => {
    expect(parseAdminInvitesMutation(fd({ intent: "showLink", inviteId: "inv-1" }))).toEqual({
      intent: "showLink",
      inviteId: "inv-1",
    })
    expect(parseAdminInvitesMutation(fd({ intent: "showLink" }))).toEqual({ error: "Missing invite ID" })
  })
})
