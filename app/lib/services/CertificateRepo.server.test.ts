// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { CertificateRepo, CertificateRepoLive, type StoreCertInput } from "./CertificateRepo.server"

const TestLayer = CertificateRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

const inDays = (days: number): Date => new Date(Date.now() + days * 86400 * 1000)

const sample = (overrides: Partial<StoreCertInput> = {}): StoreCertInput => ({
  username: "alice",
  email: "alice@example.com",
  serialNumber: "SN-0001",
  issuedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: inDays(30),
  ...overrides,
})

describe("CertificateRepo — store / findBySerial", () => {
  it.layer(TestLayer)("store inserts a cert that findBySerial can resolve", (it) => {
    it.effect("round-trip", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo

        yield* repo.store(sample({ serialNumber: "SN-A", username: "alice" }))
        const found = yield* repo.findBySerial("SN-A")

        expect(found?.username).toBe("alice")
        expect(found?.email).toBe("alice@example.com")
        expect(found?.revokedAt).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("findBySerial returns null when the serial is unknown", (it) => {
    it.effect("missing serial → null", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const found = yield* repo.findBySerial("nope")
        expect(found).toBeNull()
      }),
    )
  })
})

describe("CertificateRepo — listValid", () => {
  it.layer(TestLayer)("listValid returns active, non-expired certs for the user", (it) => {
    it.effect("active + expired + revoked → only the active row surfaces", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo

        yield* repo.store(sample({ serialNumber: "SN-ACTIVE", username: "bob", expiresAt: inDays(30) }))
        // Expired
        yield* repo.store(sample({ serialNumber: "SN-EXPIRED", username: "bob", expiresAt: inDays(-1) }))
        // Revoke-completed (revoked_at set) — listValid should drop it
        yield* repo.store(sample({ serialNumber: "SN-REVOKED", username: "bob", expiresAt: inDays(30) }))
        yield* repo.markRevokeCompleted("SN-REVOKED")

        const valid = yield* repo.listValid("bob")
        expect(valid.map((c) => c.serialNumber)).toEqual(["SN-ACTIVE"])
      }),
    )
  })

  it.layer(TestLayer)("listValid returns empty when the user has no certs", (it) => {
    it.effect("nobody → []", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const valid = yield* repo.listValid("nobody")
        expect(valid).toEqual([])
      }),
    )
  })
})

describe("CertificateRepo — listAllByUsernames", () => {
  it.layer(TestLayer)("groups rows by username", (it) => {
    it.effect("multi-user batch read", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo

        yield* repo.store(sample({ serialNumber: "SN-A1", username: "alice" }))
        yield* repo.store(sample({ serialNumber: "SN-A2", username: "alice" }))
        yield* repo.store(sample({ serialNumber: "SN-B1", username: "bob" }))

        const grouped = yield* repo.listAllByUsernames(["alice", "bob", "carol"])
        expect(grouped.alice).toHaveLength(2)
        expect(grouped.bob).toHaveLength(1)
        // carol has no certs — key not present
        expect(grouped.carol).toBeUndefined()
      }),
    )
  })

  it.layer(TestLayer)("returns {} when called with an empty username list", (it) => {
    it.effect("short-circuit on empty input", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const grouped = yield* repo.listAllByUsernames([])
        expect(grouped).toEqual({})
      }),
    )
  })
})

describe("CertificateRepo — revoke state transitions", () => {
  it.layer(TestLayer)("markRevokePending without username updates any matching cert", (it) => {
    it.effect("revoke_state set on the row", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-P", username: "alice" }))

        yield* repo.markRevokePending("SN-P")

        const found = yield* repo.findBySerial("SN-P")
        expect(found?.revokeState).toBe("pending")
        expect(found?.revokedAt).toBeNull() // not yet finalised
      }),
    )
  })

  it.layer(TestLayer)("markRevokePending with mismatched username is a no-op (ownership guard)", (it) => {
    it.effect("wrong owner can't trigger revocation", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-OWN", username: "alice" }))

        yield* repo.markRevokePending("SN-OWN", "mallory")

        const found = yield* repo.findBySerial("SN-OWN")
        expect(found?.revokeState).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("markRevokeCompleted sets revoked_at and clears revoke_error", (it) => {
    it.effect("terminal completed state", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-C", username: "alice" }))
        yield* repo.markRevokeFailed("SN-C", "transient backend error")

        yield* repo.markRevokeCompleted("SN-C")

        const found = yield* repo.findBySerial("SN-C")
        expect(found?.revokeState).toBe("completed")
        expect(found?.revokedAt).not.toBeNull()
        expect(found?.revokeError).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("markRevokeFailed records the error string", (it) => {
    it.effect("failed branch surfaces error", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-F", username: "alice" }))

        yield* repo.markRevokeFailed("SN-F", "vault 503")

        const found = yield* repo.findBySerial("SN-F")
        expect(found?.revokeState).toBe("failed")
        expect(found?.revokeError).toBe("vault 503")
      }),
    )
  })
})

describe("CertificateRepo — revokeAllForUser", () => {
  it.layer(TestLayer)("returns active serials and marks them pending", (it) => {
    it.effect("returns only currently-valid serials, leaves expired/revoked alone", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-V1", username: "alice", expiresAt: inDays(30) }))
        yield* repo.store(sample({ serialNumber: "SN-V2", username: "alice", expiresAt: inDays(30) }))
        yield* repo.store(sample({ serialNumber: "SN-EXP", username: "alice", expiresAt: inDays(-1) }))

        const serials = yield* repo.revokeAllForUser("alice")
        expect(serials.sort()).toEqual(["SN-V1", "SN-V2"])

        const v1 = yield* repo.findBySerial("SN-V1")
        expect(v1?.revokeState).toBe("pending")
      }),
    )
  })

  it.layer(TestLayer)("returns empty array when user has no active certs", (it) => {
    it.effect("nothing to revoke", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const serials = yield* repo.revokeAllForUser("ghost")
        expect(serials).toEqual([])
      }),
    )
  })
})

describe("CertificateRepo — setUserId / updateUsername", () => {
  it.layer(TestLayer)("setUserId stamps userId on rows matching the invite", (it) => {
    it.effect("invite-issued cert later linked to user", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-INV", username: "alice", inviteId: "inv-1" }))

        yield* repo.setUserId("inv-1", "user-42")

        const found = yield* repo.findBySerial("SN-INV")
        expect(found?.userId).toBe("user-42")
      }),
    )
  })

  it.layer(TestLayer)("updateUsername rewrites the username on every matching row", (it) => {
    it.effect("rename propagates", () =>
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store(sample({ serialNumber: "SN-OLD-1", username: "old" }))
        yield* repo.store(sample({ serialNumber: "SN-OLD-2", username: "old" }))
        yield* repo.store(sample({ serialNumber: "SN-OTHER", username: "carol" }))

        yield* repo.updateUsername("old", "new")

        const renamed = yield* repo.findBySerial("SN-OLD-1")
        expect(renamed?.username).toBe("new")
        const untouched = yield* repo.findBySerial("SN-OTHER")
        expect(untouched?.username).toBe("carol")
      }),
    )
  })
})
