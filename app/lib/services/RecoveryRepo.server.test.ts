// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { RecoveryRepo, RecoveryRepoLive, type CreateRecoveryInput } from "./RecoveryRepo.server"

const TestLayer = RecoveryRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

const sample = (o: Partial<CreateRecoveryInput> = {}): CreateRecoveryInput => ({
  email: "alice@example.com",
  username: "alice",
  note: null,
  requestIp: "10.0.0.1",
  ...o,
})

describe("RecoveryRepo", () => {
  it.layer(TestLayer)("create → find → list → review lifecycle", (it) => {
    it.effect("happy path", () =>
      Effect.gen(function* () {
        const repo = yield* RecoveryRepo
        const { id } = yield* repo.create(sample({ note: "lost my laptop" }))

        const found = yield* repo.findById(id)
        expect(found?.email).toBe("alice@example.com")
        expect(found?.username).toBe("alice")
        expect(found?.status).toBe("pending")
        expect(found?.note).toBe("lost my laptop")

        expect((yield* repo.listByStatus("pending")).length).toBe(1)
        expect((yield* repo.findPendingByEmail("alice@example.com"))?.id).toBe(id)

        const n = yield* repo.markReviewed(id, "approved", "admin", "ren-1")
        expect(n).toBe(1)
        const after = yield* repo.findById(id)
        expect(after?.status).toBe("approved")
        expect(after?.reviewedBy).toBe("admin")
        expect(after?.renewalId).toBe("ren-1")

        // already reviewed → 0 affected, and no longer pending
        expect(yield* repo.markReviewed(id, "denied", "admin")).toBe(0)
        expect(yield* repo.findPendingByEmail("alice@example.com")).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("at most one pending request per email", (it) => {
    it.effect("a second pending create fails (unique index)", () =>
      Effect.gen(function* () {
        const repo = yield* RecoveryRepo
        yield* repo.create(sample({ email: "bob@example.com", username: "bob" }))
        const err = yield* repo.create(sample({ email: "bob@example.com", username: "bob" })).pipe(Effect.flip)
        expect(err._tag).toBe("RecoveryRepoError")
      }),
    )
  })

  it.layer(TestLayer)("counts recent requests for rate limiting", (it) => {
    it.effect("by email and by ip, time-windowed", () =>
      Effect.gen(function* () {
        const repo = yield* RecoveryRepo
        yield* repo.create(sample({ email: "carol@example.com", username: "carol", requestIp: "1.2.3.4" }))
        const since = new Date(Date.now() - 3_600_000).toISOString()
        expect(yield* repo.countRecentByEmail("carol@example.com", since)).toBe(1)
        expect(yield* repo.countRecentByIp("1.2.3.4", since)).toBe(1)
        // a window that starts in the future sees nothing
        const future = new Date(Date.now() + 1_000).toISOString()
        expect(yield* repo.countRecentByEmail("carol@example.com", future)).toBe(0)
      }),
    )
  })
})
