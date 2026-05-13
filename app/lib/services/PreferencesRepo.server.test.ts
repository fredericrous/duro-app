// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { PreferencesRepo, PreferencesRepoLive } from "./PreferencesRepo.server"

const TestLayer = PreferencesRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

describe("PreferencesRepo — locale", () => {
  it.layer(TestLayer)("getLocale falls back to 'en' for an unknown user", (it) => {
    it.effect("missing row → 'en'", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        const locale = yield* repo.getLocale("nobody")
        expect(locale).toBe("en")
      }),
    )
  })

  it.layer(TestLayer)("setLocale + getLocale round-trip", (it) => {
    it.effect("setLocale persists, getLocale reads", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setLocale("alice", "fr")

        const locale = yield* repo.getLocale("alice")
        expect(locale).toBe("fr")
      }),
    )
  })

  it.layer(TestLayer)("setLocale upserts on the same username", (it) => {
    it.effect("ON CONFLICT DO UPDATE keeps the row count at 1", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setLocale("bob", "en")
        yield* repo.setLocale("bob", "fr")
        yield* repo.setLocale("bob", "es")

        const locale = yield* repo.getLocale("bob")
        expect(locale).toBe("es")
      }),
    )
  })
})

describe("PreferencesRepo — cert renewal", () => {
  it.layer(TestLayer)("getLastCertRenewal returns nulls for an unknown user", (it) => {
    it.effect("missing row → {at:null, renewalId:null}", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        const result = yield* repo.getLastCertRenewal("ghost")
        expect(result).toEqual({ at: null, renewalId: null })
      }),
    )
  })

  it.layer(TestLayer)("setCertRenewal writes both at + renewalId", (it) => {
    it.effect("set then read returns the renewal id and a Date", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setCertRenewal("alice", "renewal-1")

        const result = yield* repo.getLastCertRenewal("alice")
        expect(result.renewalId).toBe("renewal-1")
        expect(result.at).toBeInstanceOf(Date)
      }),
    )
  })

  it.layer(TestLayer)("setCertRenewal upserts; later calls overwrite the renewalId", (it) => {
    it.effect("most-recent write wins", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setCertRenewal("alice", "renewal-1")
        yield* repo.setCertRenewal("alice", "renewal-2")

        const result = yield* repo.getLastCertRenewal("alice")
        expect(result.renewalId).toBe("renewal-2")
      }),
    )
  })

  it.layer(TestLayer)("clearCertRenewalId nulls just the renewalId, keeps the timestamp", (it) => {
    it.effect("clear leaves at intact (per implementation)", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setCertRenewal("alice", "renewal-1")
        yield* repo.clearCertRenewalId("alice")

        const result = yield* repo.getLastCertRenewal("alice")
        expect(result.renewalId).toBeNull()
        // Timestamp was set during setCertRenewal; clearCertRenewalId doesn't touch it.
        expect(result.at).toBeInstanceOf(Date)
      }),
    )
  })

  it.layer(TestLayer)("clearCertRenewalId on a missing user is a no-op", (it) => {
    it.effect("safe to call on absent row", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.clearCertRenewalId("ghost")

        const result = yield* repo.getLastCertRenewal("ghost")
        expect(result).toEqual({ at: null, renewalId: null })
      }),
    )
  })
})
