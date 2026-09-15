// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { ApprovalPolicyRepo, ApprovalPolicyRepoLive } from "./ApprovalPolicyRepo.server"

const TestLayer = ApprovalPolicyRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

const seedApp = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ownerId = `p-${slug}-owner`
    const appId = `app-${slug}`
    yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
               VALUES (${ownerId}, 'user', ${`${slug}-owner`}, 'Owner', ${`${slug}@example.com`})`
    yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
               VALUES (${appId}, ${slug}, ${slug}, 'request', ${ownerId})`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
               VALUES (${`r-${slug}-admin`}, ${appId}, 'admin', 'Admin')`
    return appId
  })

describe("ApprovalPolicyRepo", () => {
  it.layer(TestLayer)("upsert", (it) => {
    it.effect("inserts once per scope and replaces in place on a second save", () =>
      Effect.gen(function* () {
        const repo = yield* ApprovalPolicyRepo
        const appId = yield* seedApp("upsert")

        const first = yield* repo.upsert({
          applicationId: appId,
          scopeType: "application",
          scopeId: null,
          mode: "one_of",
          rules: [{ approverType: "app_owner" }],
        })
        const second = yield* repo.upsert({
          applicationId: appId,
          scopeType: "application",
          scopeId: null,
          mode: "all_of",
          rules: [{ approverType: "app_owner" }, { approverType: "principal", approverPrincipalId: "p-x" }],
        })

        expect(second.id).toBe(first.id)
        expect(second.mode).toBe("all_of")
        expect(second.rules).toEqual([
          { approverType: "app_owner" },
          { approverType: "principal", approverPrincipalId: "p-x" },
        ])

        const listed = yield* repo.listByApplication(appId)
        expect(listed).toHaveLength(1)
      }),
    )

    it.effect("keeps application-wide and role-scoped policies apart and lists app-wide first", () =>
      Effect.gen(function* () {
        const repo = yield* ApprovalPolicyRepo
        const appId = yield* seedApp("scopes")

        yield* repo.upsert({
          applicationId: appId,
          scopeType: "role",
          scopeId: "r-scopes-admin",
          mode: "all_of",
          rules: [{ approverType: "app_owner" }],
        })
        yield* repo.upsert({
          applicationId: appId,
          scopeType: "application",
          scopeId: null,
          mode: "none",
          rules: [],
        })

        const listed = yield* repo.listByApplication(appId)
        expect(listed.map((p) => p.scopeType)).toEqual(["application", "role"])
      }),
    )
  })

  it.layer(TestLayer)("deleteByScope", (it) => {
    it.effect("removes the one policy on that scope and reports whether anything existed", () =>
      Effect.gen(function* () {
        const repo = yield* ApprovalPolicyRepo
        const appId = yield* seedApp("delete")

        yield* repo.upsert({
          applicationId: appId,
          scopeType: "application",
          scopeId: null,
          mode: "one_of",
          rules: [{ approverType: "app_owner" }],
        })
        yield* repo.upsert({
          applicationId: appId,
          scopeType: "role",
          scopeId: "r-delete-admin",
          mode: "one_of",
          rules: [{ approverType: "app_owner" }],
        })

        expect(yield* repo.deleteByScope(appId, "role", "r-delete-admin")).toBe(true)
        expect(yield* repo.deleteByScope(appId, "role", "r-delete-admin")).toBe(false)
        const listed = yield* repo.listByApplication(appId)
        expect(listed.map((p) => p.scopeType)).toEqual(["application"])
      }),
    )
  })
})
