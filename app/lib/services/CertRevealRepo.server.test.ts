// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { CertRevealRepo, CertRevealRepoLive } from "./CertRevealRepo.server"
import { hashToken } from "~/lib/crypto.server"

const TestLayer = CertRevealRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

const input = (over: Partial<Parameters<typeof CertRevealRepo.Service.create>[0]> = {}) => ({
  renewalId: "renew-1",
  email: "daddy@example.com",
  username: "daddy",
  expiresAt: new Date(Date.now() + 60_000),
  ...over,
})

describe("CertRevealRepo", () => {
  it.layer(TestLayer)("create → findByTokenHash round-trip", (it) => {
    it.effect("returns a raw token; only its hash is stored and looked up by hash", () =>
      Effect.gen(function* () {
        const repo = yield* CertRevealRepo
        const { id, token } = yield* repo.create(input())

        expect(id).toMatch(/^[0-9a-f-]{36}$/i)
        expect(token.length).toBeGreaterThan(20)

        // Looking up by the RAW token must miss — we only persist the hash.
        expect(yield* repo.findByTokenHash(token)).toBeNull()

        const row = yield* repo.findByTokenHash(hashToken(token))
        expect(row).not.toBeNull()
        expect(row!.id).toBe(id)
        expect(row!.renewalId).toBe("renew-1")
        expect(row!.email).toBe("daddy@example.com")
        expect(row!.username).toBe("daddy")
        expect(row!.revealedAt).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("markRevealed", (it) => {
    it.effect("stamps revealed_at once and is idempotent", () =>
      Effect.gen(function* () {
        const repo = yield* CertRevealRepo
        const { id, token } = yield* repo.create(input({ renewalId: "renew-2" }))

        yield* repo.markRevealed(id)
        const after = yield* repo.findByTokenHash(hashToken(token))
        expect(after!.revealedAt).not.toBeNull()
        const firstStamp = after!.revealedAt

        // Idempotent — a second call does not move the timestamp (guarded by
        // `revealed_at IS NULL`).
        yield* repo.markRevealed(id)
        const again = yield* repo.findByTokenHash(hashToken(token))
        expect(again!.revealedAt).toEqual(firstStamp)
      }),
    )
  })

  it.layer(TestLayer)("expiry", (it) => {
    it.effect("an expired token is still found (caller enforces expiry, not the repo)", () =>
      Effect.gen(function* () {
        const repo = yield* CertRevealRepo
        const { token } = yield* repo.create(input({ renewalId: "renew-3", expiresAt: new Date(Date.now() - 1000) }))

        const row = yield* repo.findByTokenHash(hashToken(token))
        expect(row).not.toBeNull()
        expect(new Date(row!.expiresAt).getTime()).toBeLessThan(Date.now())
      }),
    )
  })
})
