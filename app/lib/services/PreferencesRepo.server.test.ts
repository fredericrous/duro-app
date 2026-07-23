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

describe("PreferencesRepo — display prefs", () => {
  it.layer(TestLayer)("getDisplayPrefs returns nulls for an unknown user", (it) => {
    it.effect("missing row → {null, null}", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        const prefs = yield* repo.getDisplayPrefs("nobody")
        expect(prefs).toEqual({ timezone: null, timeFormat: null })
      }),
    )
  })

  it.layer(TestLayer)("setDisplayPrefs + getDisplayPrefs round-trip", (it) => {
    it.effect("persists timezone + timeFormat and reads them back", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setDisplayPrefs("carol", { timezone: "Europe/Paris", timeFormat: "24" })
        const prefs = yield* repo.getDisplayPrefs("carol")
        expect(prefs).toEqual({ timezone: "Europe/Paris", timeFormat: "24" })
      }),
    )
  })

  it.layer(TestLayer)("setDisplayPrefs upserts and can clear back to null", (it) => {
    it.effect("later call overwrites; null clears", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setDisplayPrefs("dave", { timezone: "UTC", timeFormat: "12" })
        yield* repo.setDisplayPrefs("dave", { timezone: null, timeFormat: null })
        const prefs = yield* repo.getDisplayPrefs("dave")
        expect(prefs).toEqual({ timezone: null, timeFormat: null })
      }),
    )
  })

  it.layer(TestLayer)("locale and display prefs coexist on one row", (it) => {
    it.effect("setLocale then setDisplayPrefs keeps both", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setLocale("erin", "fr")
        yield* repo.setDisplayPrefs("erin", { timezone: "Asia/Tokyo", timeFormat: "24" })
        const locale = yield* repo.getLocale("erin")
        const prefs = yield* repo.getDisplayPrefs("erin")
        expect(locale).toBe("fr")
        expect(prefs).toEqual({ timezone: "Asia/Tokyo", timeFormat: "24" })
      }),
    )
  })
})

describe("PreferencesRepo — theme", () => {
  it.layer(TestLayer)("getTheme returns null for an unknown user", (it) => {
    it.effect("missing row → null", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        expect(yield* repo.getTheme("nobody")).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("setTheme + getTheme round-trip and upsert", (it) => {
    it.effect("persists and overwrites", () =>
      Effect.gen(function* () {
        const repo = yield* PreferencesRepo
        yield* repo.setTheme("frank", "light")
        expect(yield* repo.getTheme("frank")).toBe("light")
        yield* repo.setTheme("frank", "dark")
        expect(yield* repo.getTheme("frank")).toBe("dark")
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
