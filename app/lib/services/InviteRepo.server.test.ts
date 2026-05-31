// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { InviteRepo, InviteRepoLive, InviteError } from "./InviteRepo.server"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { hashToken } from "~/lib/crypto.server"

const TestLayer = InviteRepoLive.pipe(Layer.provide(makeTestDbLayer()))

describe("InviteRepo", () => {
  it.layer(TestLayer)("create + findById", (it) => {
    it.effect("creates an invite and retrieves it by id", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, token } = yield* repo.create({
          email: "alice@example.com",
          groups: [1, 2],
          groupNames: ["friends", "family"],
          invitedBy: "admin",
        })

        expect(id).toBeDefined()
        expect(token).toBeDefined()

        const invite = yield* repo.findById(id)
        expect(invite).not.toBeNull()
        expect(invite!.email).toBe("alice@example.com")
        expect(invite!.invitedBy).toBe("admin")
        expect(invite!.groups).toBe(JSON.stringify([1, 2]))
        expect(invite!.groupNames).toBe(JSON.stringify(["friends", "family"]))
        expect(invite!.usedAt).toBeNull()
        expect(invite!.attempts).toBe(0)
        expect(invite!.token).toBeDefined()
        expect(invite!.token.length).toBeGreaterThan(0)
      }),
    )

    it.effect("stores token for deferred email URL construction", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "token-test@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const invite = yield* repo.findById(id)
        expect(invite!.token).toBeDefined()
        expect(invite!.token.length).toBeGreaterThan(0)
      }),
    )

    it.effect("finds invite by token hash", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { token } = yield* repo.create({
          email: "bob@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const tokenHash = hashToken(token)
        const invite = yield* repo.findByTokenHash(tokenHash)
        expect(invite).not.toBeNull()
        expect(invite!.email).toBe("bob@example.com")
      }),
    )

    it.effect("returns null for non-existent token hash", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const invite = yield* repo.findByTokenHash("nonexistent")
        expect(invite).toBeNull()
      }),
    )

    it.effect("rejects duplicate pending invites for same email", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        yield* repo.create({
          email: "dup@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const result = yield* repo
          .create({
            email: "dup@example.com",
            groups: [1],
            groupNames: ["friends"],
            invitedBy: "admin",
          })
          .pipe(Effect.flip)

        expect(result).toBeInstanceOf(InviteError)
        expect(result.message).toContain("Pending invite already exists")
      }),
    )
  })

  it.layer(TestLayer)("typed columns default values", (it) => {
    it.effect("default typed columns are false/null", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "defaults@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const invite = yield* repo.findById(id)
        expect(invite).not.toBeNull()
        expect(invite!.certIssued).toBe(false)
        expect(invite!.prCreated).toBe(false)
        expect(invite!.prNumber).toBeNull()
        expect(invite!.prMerged).toBe(false)
        expect(invite!.emailSent).toBe(false)
      }),
    )
  })

  it.layer(TestLayer)("typed mark methods", (it) => {
    it.effect("markCertIssued sets cert_issued to true", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "cert@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.markCertIssued(id)
        const invite = yield* repo.findById(id)
        expect(invite!.certIssued).toBe(true)
      }),
    )

    it.effect("markPRCreated sets pr_created and pr_number", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "pr@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.markPRCreated(id, 42)
        const invite = yield* repo.findById(id)
        expect(invite!.prCreated).toBe(true)
        expect(invite!.prNumber).toBe(42)
      }),
    )

    it.effect("markPRMerged sets pr_merged to true", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "merged@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.markPRCreated(id, 42)
        yield* repo.markPRMerged(id)
        const invite = yield* repo.findById(id)
        expect(invite!.prMerged).toBe(true)
      }),
    )

    it.effect("markEmailSent sets email_sent to true", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "email@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.markEmailSent(id)
        const invite = yield* repo.findById(id)
        expect(invite!.emailSent).toBe(true)
      }),
    )
  })

  it.layer(TestLayer)("findAwaitingMerge", (it) => {
    it.effect("returns invites with PR but no email", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo

        // Invite 1: PR created, no email -> should match
        const { id: id1 } = yield* repo.create({
          email: "awaiting1@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        yield* repo.markPRCreated(id1, 10)

        // Invite 2: PR created + email sent -> should NOT match
        const { id: id2 } = yield* repo.create({
          email: "awaiting2@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        yield* repo.markPRCreated(id2, 11)
        yield* repo.markEmailSent(id2)

        const result = yield* repo.findAwaitingMerge()
        expect(result).toHaveLength(1)
        expect(result[0].prNumber).toBe(10)
      }),
    )

    it.effect("excludes used invites", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "revoked@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        yield* repo.markPRCreated(id, 10)
        yield* repo.revoke(id)

        const result = yield* repo.findAwaitingMerge()
        // The revoked invite should not appear
        const revokedInResult = result.find((inv) => inv.id === id)
        expect(revokedInResult).toBeUndefined()
      }),
    )
  })

  it.layer(TestLayer)("consumeByToken", (it) => {
    it.effect("consumes a valid invite", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, token } = yield* repo.create({
          email: "consume@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const consumed = yield* repo.consumeByToken(token)
        expect(consumed.id).toBe(id)
        expect(consumed.usedAt).not.toBeNull()
      }),
    )

    it.effect("fails to consume an already-consumed invite", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { token } = yield* repo.create({
          email: "double@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.consumeByToken(token)
        const error = yield* repo.consumeByToken(token).pipe(Effect.flip)
        expect(error).toBeInstanceOf(InviteError)
        expect(error.message).toContain("invalid, expired, or already used")
      }),
    )
  })

  it.layer(TestLayer)("markUsedBy + findPending", (it) => {
    it.effect("marks an invite as used by a username", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, token } = yield* repo.create({
          email: "mark@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.consumeByToken(token)
        yield* repo.markUsedBy(id, "markuser")

        const invite = yield* repo.findById(id)
        expect(invite!.usedBy).toBe("markuser")
      }),
    )

    it.effect("findPending returns only unconsumed non-expired invites", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        yield* repo.create({
          email: "pending1@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        const { token: t2 } = yield* repo.create({
          email: "pending2@example.com",
          groups: [2],
          groupNames: ["family"],
          invitedBy: "admin",
        })

        // Consume one
        yield* repo.consumeByToken(t2)

        const pending = yield* repo.findPending()
        expect(pending).toHaveLength(1)
        expect(pending[0].email).toBe("pending1@example.com")
      }),
    )
  })

  it.layer(TestLayer)("incrementAttempt", (it) => {
    it.effect("increments the attempt counter", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { token } = yield* repo.create({
          email: "attempt@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const tokenHash = hashToken(token)
        yield* repo.incrementAttempt(tokenHash)
        yield* repo.incrementAttempt(tokenHash)

        const invite = yield* repo.findByTokenHash(tokenHash)
        expect(invite!.attempts).toBe(2)
        expect(invite!.lastAttemptAt).not.toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("reconcile error tracking", (it) => {
    it.effect("recordReconcileError increments count and stores message", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "reconcile@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.recordReconcileError(id, "SMTP connection refused")
        let invite = yield* repo.findById(id)
        expect(invite!.reconcileAttempts).toBe(1)
        expect(invite!.lastError).toBe("SMTP connection refused")
        expect(invite!.lastReconcileAt).not.toBeNull()

        yield* repo.recordReconcileError(id, "SMTP timeout")
        invite = yield* repo.findById(id)
        expect(invite!.reconcileAttempts).toBe(2)
        expect(invite!.lastError).toBe("SMTP timeout")
      }),
    )

    it.effect("markFailed sets failed_at", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "failed@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.markFailed(id, "max retries exceeded")
        const invite = yield* repo.findById(id)
        expect(invite!.failedAt).not.toBeNull()
        expect(invite!.lastError).toBe("max retries exceeded")
      }),
    )

    it.effect("clearReconcileError resets all fields", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "clear@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.recordReconcileError(id, "some error")
        yield* repo.markFailed(id, "permanent")
        yield* repo.clearReconcileError(id)

        const invite = yield* repo.findById(id)
        expect(invite!.reconcileAttempts).toBe(0)
        expect(invite!.lastReconcileAt).toBeNull()
        expect(invite!.lastError).toBeNull()
        expect(invite!.failedAt).toBeNull()
      }),
    )

    it.effect("findFailed returns only failed invites", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo

        const { id: id1 } = yield* repo.create({
          email: "fail1@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        yield* repo.markFailed(id1, "error1")

        yield* repo.create({
          email: "ok@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        const failed = yield* repo.findFailed()
        // Shared DB may contain failed invites from earlier tests in this group
        const myFailed = failed.filter((i) => i.email === "fail1@example.com")
        expect(myFailed).toHaveLength(1)
        // Ensure the non-failed invite is NOT in the results
        expect(failed.find((i) => i.email === "ok@example.com")).toBeUndefined()
      }),
    )

    it.effect("findAwaitingMerge excludes failed invites", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo

        const { id: id1 } = yield* repo.create({
          email: "awaiting-ok@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        yield* repo.markPRCreated(id1, 100)

        const { id: id2 } = yield* repo.create({
          email: "awaiting-fail@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        yield* repo.markPRCreated(id2, 101)
        yield* repo.markFailed(id2, "permanent failure")

        const result = yield* repo.findAwaitingMerge()
        expect(result).toHaveLength(1)
        expect(result[0].email).toBe("awaiting-ok@example.com")
      }),
    )
  })

  it.layer(TestLayer)("revoke + deleteById", (it) => {
    it.effect("revokes a pending invite", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "revoke@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.revoke(id)
        const invite = yield* repo.findById(id)
        expect(invite!.usedBy).toBe("__revoked__")
        expect(invite!.usedAt).not.toBeNull()
      }),
    )

    it.effect("fails to revoke an already-used invite", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "revoke-used@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.revoke(id)
        const error = yield* repo.revoke(id).pipe(Effect.flip)
        expect(error).toBeInstanceOf(InviteError)
        expect(error.message).toContain("not found or already used")
      }),
    )

    it.effect("deletes an invite by id", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "delete@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.deleteById(id)
        const invite = yield* repo.findById(id)
        expect(invite).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("user revocations", (it) => {
    it.effect("records and finds revocations", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo

        yield* repo.recordRevocation("alice@example.com", "alice", "admin", "Left the team")

        const revocations = yield* repo.findRevocations()
        expect(revocations).toHaveLength(1)
        expect(revocations[0].email).toBe("alice@example.com")
        expect(revocations[0].username).toBe("alice")
        expect(revocations[0].reason).toBe("Left the team")
        expect(revocations[0].revokedBy).toBe("admin")
        expect(revocations[0].revokedAt).toBeDefined()
      }),
    )

    it.effect("records revocation without reason", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo

        yield* repo.recordRevocation("bob@example.com", "bob", "admin")

        const revocation = yield* repo.findRevocationByEmail("bob@example.com")
        expect(revocation).not.toBeNull()
        expect(revocation!.reason).toBeNull()
      }),
    )

    it.effect("findRevocationByEmail returns null for unknown email", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const result = yield* repo.findRevocationByEmail("nobody@example.com")
        expect(result).toBeNull()
      }),
    )

    it.effect("deleteRevocation removes the record", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo

        yield* repo.recordRevocation("charlie@example.com", "charlie", "admin", "test")

        const revocation = yield* repo.findRevocationByEmail("charlie@example.com")
        expect(revocation).not.toBeNull()

        yield* repo.deleteRevocation(revocation!.id)

        const after = yield* repo.findRevocationByEmail("charlie@example.com")
        expect(after).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("open tracking", (it) => {
    it.effect("create returns a distinct openToken and stores it", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, token, openToken } = yield* repo.create({
          email: "open-create@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        expect(openToken).toBeDefined()
        expect(openToken.length).toBeGreaterThan(0)
        // Must NOT reuse the invite token (which grants account creation).
        expect(openToken).not.toBe(token)

        const invite = yield* repo.findById(id)
        expect(invite!.openToken).toBe(openToken)
        expect(invite!.openCount).toBe(0)
        expect(invite!.firstOpenedAt).toBeNull()
        expect(invite!.lastOpenedAt).toBeNull()
        expect(invite!.lastOpenUserAgent).toBeNull()
      }),
    )

    it.effect("recordOpen sets first/last/count/UA and keeps first stable on re-open", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, openToken } = yield* repo.create({
          email: "open-record@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.recordOpen(openToken, "Mozilla/5.0 (Macintosh)")
        const first = yield* repo.findById(id)
        expect(first!.openCount).toBe(1)
        expect(first!.firstOpenedAt).not.toBeNull()
        expect(first!.lastOpenedAt).not.toBeNull()
        expect(first!.lastOpenUserAgent).toBe("Mozilla/5.0 (Macintosh)")

        yield* repo.recordOpen(openToken, "GoogleImageProxy")
        const second = yield* repo.findById(id)
        expect(second!.openCount).toBe(2)
        // first_opened_at must not move on subsequent opens
        expect(second!.firstOpenedAt).toBe(first!.firstOpenedAt)
        expect(second!.lastOpenUserAgent).toBe("GoogleImageProxy")
      }),
    )

    it.effect("recordOpen truncates an oversized user agent to 512 chars", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, openToken } = yield* repo.create({
          email: "open-ua@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.recordOpen(openToken, "x".repeat(2000))
        const invite = yield* repo.findById(id)
        expect(invite!.lastOpenUserAgent!.length).toBe(512)
      }),
    )

    it.effect("recordOpen is a no-op for an unknown openToken", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "open-unknown@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        // Must not throw, and must not touch any existing invite.
        yield* repo.recordOpen("totally-unknown-token", "anything")
        const invite = yield* repo.findById(id)
        expect(invite!.openCount).toBe(0)
        expect(invite!.firstOpenedAt).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("click tracking", (it) => {
    it.effect("recordClick (keyed by token hash) sets first/last/count/UA and keeps first stable", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, token } = yield* repo.create({
          email: "click-record@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })
        const tokenHash = hashToken(token)

        yield* repo.recordClick(tokenHash, "Mozilla/5.0 (iPhone)")
        const first = yield* repo.findById(id)
        expect(first!.clickCount).toBe(1)
        expect(first!.firstClickedAt).not.toBeNull()
        expect(first!.lastClickUserAgent).toBe("Mozilla/5.0 (iPhone)")

        yield* repo.recordClick(tokenHash, "Outlook SafeLinks")
        const second = yield* repo.findById(id)
        expect(second!.clickCount).toBe(2)
        expect(second!.firstClickedAt).toBe(first!.firstClickedAt)
        expect(second!.lastClickUserAgent).toBe("Outlook SafeLinks")
      }),
    )

    it.effect("recordClick truncates an oversized user agent to 512 chars", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id, token } = yield* repo.create({
          email: "click-ua@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.recordClick(hashToken(token), "y".repeat(2000))
        const invite = yield* repo.findById(id)
        expect(invite!.lastClickUserAgent!.length).toBe(512)
      }),
    )

    it.effect("recordClick is a no-op for an unknown token hash", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "click-unknown@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.recordClick("nonexistent-hash", "anything")
        const invite = yield* repo.findById(id)
        expect(invite!.clickCount).toBe(0)
        expect(invite!.firstClickedAt).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("delivery tracking", (it) => {
    const seed = (email: string) =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({ email, groups: [1], groupNames: ["friends"], invitedBy: "admin" })
        return { repo, id }
      })

    it.effect("setMessageId + findByMessageId round-trips", () =>
      Effect.gen(function* () {
        const { repo, id } = yield* seed("msg@example.com")
        yield* repo.setMessageId(id, "<invite-mid-1@daddyshome.fr>")
        const found = yield* repo.findByMessageId("<invite-mid-1@daddyshome.fr>")
        expect(found?.id).toBe(id)
        expect(yield* repo.findByMessageId("<nope@x>")).toBeNull()
      }),
    )

    it.effect("findLatestByEmail returns the most recently created invite", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const first = yield* repo.create({ email: "dup@x.com", groups: [1], groupNames: ["f"], invitedBy: "admin" })
        // revoke so create() allows a second live invite for the same email
        yield* repo.revoke(first.id)
        const second = yield* repo.create({ email: "dup@x.com", groups: [1], groupNames: ["f"], invitedBy: "admin" })
        const latest = yield* repo.findLatestByEmail("dup@x.com")
        expect(latest?.id).toBe(second.id)
      }),
    )

    it.effect("recordDelivery sets status + delivered_at and is monotonic (no downgrade)", () =>
      Effect.gen(function* () {
        const { repo, id } = yield* seed("deliver@example.com")

        yield* repo.recordDelivery(id, { status: "deferred", detail: "451 try later", at: new Date().toISOString() })
        let inv = yield* repo.findById(id)
        expect(inv!.deliveryStatus).toBe("deferred")
        expect(inv!.deliveredAt).toBeNull()

        const at = new Date().toISOString()
        yield* repo.recordDelivery(id, { status: "delivered", detail: "250 OK", at })
        inv = yield* repo.findById(id)
        expect(inv!.deliveryStatus).toBe("delivered")
        expect(inv!.deliveredAt).not.toBeNull()

        // A late 'deferred' must NOT downgrade a delivered invite.
        yield* repo.recordDelivery(id, { status: "deferred", detail: "late", at: new Date().toISOString() })
        inv = yield* repo.findById(id)
        expect(inv!.deliveryStatus).toBe("delivered")
      }),
    )

    it.effect("recordDelivery records a bounce with reason", () =>
      Effect.gen(function* () {
        const { repo, id } = yield* seed("bounce@example.com")
        yield* repo.recordDelivery(id, {
          status: "bounced",
          detail: "550 5.1.1 No such user",
          at: new Date().toISOString(),
        })
        const inv = yield* repo.findById(id)
        expect(inv!.deliveryStatus).toBe("bounced")
        expect(inv!.bouncedAt).not.toBeNull()
        expect(inv!.deliveryDetail).toBe("550 5.1.1 No such user")
      }),
    )

    it.effect("recordDelivery truncates an oversized detail to 512 chars", () =>
      Effect.gen(function* () {
        const { repo, id } = yield* seed("trunc@example.com")
        yield* repo.recordDelivery(id, { status: "bounced", detail: "z".repeat(2000), at: new Date().toISOString() })
        const inv = yield* repo.findById(id)
        expect(inv!.deliveryDetail!.length).toBe(512)
      }),
    )
  })
})
