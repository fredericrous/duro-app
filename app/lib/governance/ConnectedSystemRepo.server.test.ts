// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { ConnectedSystemRepo, ConnectedSystemRepoLive } from "./ConnectedSystemRepo.server"

const TestLayer = ConnectedSystemRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

const seedApp = (slug = "test-app") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ownerId = "p-cs-owner"
    const appId = `app-${slug}`
    yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
               VALUES (${ownerId}, 'user', 'csowner', 'CS Owner', 'csowner@example.com')`
    yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
               VALUES (${appId}, ${slug}, ${slug}, 'request', ${ownerId})`
    return appId
  })

describe("ConnectedSystemRepo", () => {
  it.layer(TestLayer)("create stores config as JSONB and applies defaults", (it) => {
    it.effect("happy path", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appId = yield* seedApp()

        const cs = yield* repo.create({
          applicationId: appId,
          connectorType: "http",
          config: { baseUrl: "https://example.com", token: "abc" },
        })

        expect(cs.applicationId).toBe(appId)
        expect(cs.connectorType).toBe("http")
        expect(cs.config).toEqual({ baseUrl: "https://example.com", token: "abc" })
        // Default status
        expect(cs.status).toBe("active")
        expect(cs.pluginSlug).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("create stores plugin fields when provided", (it) => {
    it.effect("plugin connector with version", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appId = yield* seedApp("gitea")

        const cs = yield* repo.create({
          applicationId: appId,
          connectorType: "plugin",
          config: { teams: ["dev"] },
          pluginSlug: "gitea-teams",
          pluginVersion: "1.2.3",
          status: "disabled",
        })

        expect(cs.pluginSlug).toBe("gitea-teams")
        expect(cs.pluginVersion).toBe("1.2.3")
        expect(cs.status).toBe("disabled")
      }),
    )
  })

  it.layer(TestLayer)("findById returns the row", (it) => {
    it.effect("happy path + miss", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appId = yield* seedApp()
        const created = yield* repo.create({
          applicationId: appId,
          connectorType: "http",
          config: {},
        })

        const found = yield* repo.findById(created.id)
        expect(found?.id).toBe(created.id)

        const missing = yield* repo.findById("does-not-exist")
        expect(missing).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("findByApplicationAndType narrows by (app, type)", (it) => {
    it.effect("matches one, returns null otherwise", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appId = yield* seedApp()
        yield* repo.create({ applicationId: appId, connectorType: "http", config: {} })
        yield* repo.create({ applicationId: appId, connectorType: "ldap", config: {} })

        const http = yield* repo.findByApplicationAndType(appId, "http")
        expect(http?.connectorType).toBe("http")

        const scim = yield* repo.findByApplicationAndType(appId, "scim")
        expect(scim).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("findByApplicationAndPlugin narrows by (app, plugin)", (it) => {
    it.effect("matches plugin row", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appId = yield* seedApp()
        yield* repo.create({
          applicationId: appId,
          connectorType: "plugin",
          pluginSlug: "gitea-teams",
          pluginVersion: "1.0.0",
          config: {},
        })

        const found = yield* repo.findByApplicationAndPlugin(appId, "gitea-teams")
        expect(found?.pluginSlug).toBe("gitea-teams")

        const missing = yield* repo.findByApplicationAndPlugin(appId, "other")
        expect(missing).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("countByPluginSlug groups plugin rows", (it) => {
    it.effect("counts active plugin connectors only", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appId = yield* seedApp("a")
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-b', 'b', 'B', 'request', 'p-cs-owner')`

        yield* repo.create({
          applicationId: appId,
          connectorType: "plugin",
          pluginSlug: "gitea-teams",
          pluginVersion: "1.0.0",
          config: {},
        })
        yield* repo.create({
          applicationId: "app-b",
          connectorType: "plugin",
          pluginSlug: "gitea-teams",
          pluginVersion: "1.0.0",
          config: {},
        })
        yield* repo.create({
          applicationId: appId,
          connectorType: "plugin",
          pluginSlug: "plex-libs",
          pluginVersion: "1.0.0",
          config: {},
        })
        // Non-plugin row is excluded
        yield* repo.create({ applicationId: appId, connectorType: "http", config: {} })

        const counts = yield* repo.countByPluginSlug()
        const map = Object.fromEntries(counts.map((c) => [c.pluginSlug, c.count]))
        expect(map["gitea-teams"]).toBe(2)
        expect(map["plex-libs"]).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("listByApplication returns rows for one app", (it) => {
    it.effect("filters by applicationId", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectedSystemRepo
        const appA = yield* seedApp("aa")
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-bb', 'bb', 'BB', 'request', 'p-cs-owner')`

        yield* repo.create({ applicationId: appA, connectorType: "http", config: {} })
        yield* repo.create({ applicationId: appA, connectorType: "ldap", config: {} })
        yield* repo.create({ applicationId: "app-bb", connectorType: "http", config: {} })

        const list = yield* repo.listByApplication(appA)
        expect(list).toHaveLength(2)
        expect(list.every((cs) => cs.applicationId === appA)).toBe(true)

        const empty = yield* repo.listByApplication("no-such-app")
        expect(empty).toEqual([])
      }),
    )
  })
})
