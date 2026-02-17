import { describe, expect, beforeAll } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { InviteRepo, InviteRepoLive, InviteError } from "./InviteRepo.server"
import { hashToken } from "~/lib/crypto.server"

// Use in-memory SQLite for tests
beforeAll(() => {
  process.env.DURO_DB_PATH = ":memory:"
})

// Each describe block gets its own InviteRepoLive (fresh in-memory DB)
describe("InviteRepo", () => {
  it.layer(InviteRepoLive)("create + findById", (it) => {
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

  it.layer(InviteRepoLive)("consumeByToken", (it) => {
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

  it.layer(InviteRepoLive)("markUsedBy + findPending", (it) => {
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

  it.layer(InviteRepoLive)("incrementAttempt", (it) => {
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

  it.layer(InviteRepoLive)("updateStepState", (it) => {
    it.effect("patches step state JSON", () =>
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const { id } = yield* repo.create({
          email: "step@example.com",
          groups: [1],
          groupNames: ["friends"],
          invitedBy: "admin",
        })

        yield* repo.updateStepState(id, { certIssued: true })
        let invite = yield* repo.findById(id)
        expect(JSON.parse(invite!.stepState)).toEqual({ certIssued: true })

        yield* repo.updateStepState(id, { emailSent: true })
        invite = yield* repo.findById(id)
        expect(JSON.parse(invite!.stepState)).toEqual({
          certIssued: true,
          emailSent: true,
        })
      }),
    )
  })

  it.layer(InviteRepoLive)("revoke + deleteById", (it) => {
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
})
