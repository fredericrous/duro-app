// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { ApplicationRepo, ApplicationRepoLive } from "./ApplicationRepo.server"

const TestLayer = ApplicationRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

// makeTestDbLayer truncates tables once per `it.layer` block — NOT per
// `it.effect`. Each test below uses its own `it.layer` so state is fresh.

const seedOwner = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const ownerId = "p-app-owner"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${ownerId}, 'user', 'appowner', 'App Owner', 'appowner@example.com')`
  return ownerId
})

describe("ApplicationRepo", () => {
  it.layer(TestLayer)("create inserts an application with required + defaulted fields", (it) => {
    it.effect("happy path", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner

        const app = yield* repo.create({
          slug: "jellyfin",
          displayName: "Jellyfin",
          ownerId,
        })

        expect(app.slug).toBe("jellyfin")
        expect(app.displayName).toBe("Jellyfin")
        expect(app.accessMode).toBe("invite_only")
        expect(app.enabled).toBe(true)
        expect(app.description).toBeNull()
        expect(app.url).toBeNull()
        expect(app.ownerId).toBe(ownerId)
        expect(app.id).toBeDefined()
      }),
    )
  })

  it.layer(TestLayer)("create honors provided overrides", (it) => {
    it.effect("uses non-default accessMode, description, url, lastSyncedAt", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner

        const app = yield* repo.create({
          slug: "navidrome",
          displayName: "Navidrome",
          description: "Music streaming",
          accessMode: "open",
          ownerId,
          lastSyncedAt: "2026-01-01T00:00:00Z",
          url: "https://music.example.com",
        })

        expect(app.accessMode).toBe("open")
        expect(app.description).toBe("Music streaming")
        expect(app.url).toBe("https://music.example.com")
      }),
    )
  })

  it.layer(TestLayer)("findById returns the row when present", (it) => {
    it.effect("returns the created row", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner
        const created = yield* repo.create({ slug: "gitea", displayName: "Gitea", ownerId })

        const found = yield* repo.findById(created.id)
        expect(found?.slug).toBe("gitea")
      }),
    )
  })

  it.layer(TestLayer)("findById returns null when missing", (it) => {
    it.effect("missing id resolves to null", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const found = yield* repo.findById("nope")
        expect(found).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("findBySlug returns the row matching the slug", (it) => {
    it.effect("returns row by slug", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner
        yield* repo.create({ slug: "plex", displayName: "Plex", ownerId })

        const found = yield* repo.findBySlug("plex")
        expect(found?.displayName).toBe("Plex")
      }),
    )
  })

  it.layer(TestLayer)("findBySlug returns null when no slug matches", (it) => {
    it.effect("missing slug resolves to null", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const found = yield* repo.findBySlug("nonexistent")
        expect(found).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("list returns every persisted app", (it) => {
    it.effect("all inserted slugs surface", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner

        yield* repo.create({ slug: "first", displayName: "First", ownerId })
        yield* repo.create({ slug: "second", displayName: "Second", ownerId })
        yield* repo.create({ slug: "third", displayName: "Third", ownerId })

        const all = yield* repo.list()
        expect(all).toHaveLength(3)
        expect(all.map((a) => a.slug).sort()).toEqual(["first", "second", "third"])
      }),
    )
  })

  it.layer(TestLayer)("list returns empty array when no apps exist", (it) => {
    it.effect("empty table returns []", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const all = yield* repo.list()
        expect(all).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("update changes only the supplied fields", (it) => {
    it.effect("displayName change leaves description + accessMode untouched", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner
        const created = yield* repo.create({
          slug: "immich",
          displayName: "Immich",
          description: "Photos",
          accessMode: "open",
          ownerId,
        })

        yield* repo.update(created.id, { displayName: "Immich Photo Server" })

        const found = yield* repo.findById(created.id)
        expect(found?.displayName).toBe("Immich Photo Server")
        expect(found?.description).toBe("Photos")
        expect(found?.accessMode).toBe("open")
      }),
    )
  })

  it.layer(TestLayer)("update supports clearing url to null", (it) => {
    it.effect("explicit null clears the column", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner
        const created = yield* repo.create({
          slug: "lldap",
          displayName: "LLDAP",
          url: "https://ldap.example.com",
          ownerId,
        })

        yield* repo.update(created.id, { url: null })

        const found = yield* repo.findById(created.id)
        expect(found?.url).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("update can flip enabled to false", (it) => {
    it.effect("enabled = false persists", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner
        const created = yield* repo.create({ slug: "vault", displayName: "Vault", ownerId })
        expect(created.enabled).toBe(true)

        yield* repo.update(created.id, { enabled: false })

        const found = yield* repo.findById(created.id)
        expect(found?.enabled).toBe(false)
      }),
    )
  })

  it.layer(TestLayer)("update is a no-op when fields is empty", (it) => {
    it.effect("empty object leaves fields unchanged", () =>
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const ownerId = yield* seedOwner
        const created = yield* repo.create({
          slug: "stable",
          displayName: "Stable Name",
          description: "Stable Desc",
          ownerId,
        })

        yield* repo.update(created.id, {})

        const found = yield* repo.findById(created.id)
        expect(found?.displayName).toBe("Stable Name")
        expect(found?.description).toBe("Stable Desc")
      }),
    )
  })
})
