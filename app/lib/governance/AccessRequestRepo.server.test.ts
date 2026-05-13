// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { AccessRequestRepo, AccessRequestRepoLive } from "./AccessRequestRepo.server"

const TestLayer = AccessRequestRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

/**
 * Seeds: requester principal, approver principal, application, role,
 * entitlement, and a grant placeholder row. Returns the ids the tests
 * compose into requests/approvals.
 */
const seedAll = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-requester', 'user', 'requester', 'Requester', 'req@example.com')`
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-approver', 'user', 'approver', 'Approver', 'app@example.com')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-ar', 'ar', 'AR App', 'request', 'p-requester')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-editor', 'app-ar', 'editor', 'Editor')`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES ('ent-edit', 'app-ar', 'edit', 'Edit')`
  return {
    requesterId: "p-requester",
    approverId: "p-approver",
    applicationId: "app-ar",
    roleId: "role-editor",
    entitlementId: "ent-edit",
  }
})

describe("AccessRequestRepo — create / findById", () => {
  it.layer(TestLayer)("create inserts a pending request with the supplied fields", (it) => {
    it.effect("happy path with role", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
          justification: "Need to edit",
          requestedDurationHours: 24,
        })

        expect(req.requesterId).toBe(ids.requesterId)
        expect(req.applicationId).toBe(ids.applicationId)
        expect(req.roleId).toBe(ids.roleId)
        expect(req.entitlementId).toBeNull()
        expect(req.justification).toBe("Need to edit")
        expect(req.requestedDurationHours).toBe(24)
        expect(req.status).toBe("pending")
      }),
    )
  })

  it.layer(TestLayer)("create supports entitlement-only requests", (it) => {
    it.effect("entitlement instead of role", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          entitlementId: ids.entitlementId,
        })

        expect(req.entitlementId).toBe(ids.entitlementId)
        expect(req.roleId).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("findById returns null for unknown id", (it) => {
    it.effect("missing → null", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const found = yield* repo.findById("no-such-id")
        expect(found).toBeNull()
      }),
    )
  })
})

describe("AccessRequestRepo — listings", () => {
  it.layer(TestLayer)("listPending returns only pending rows (FIFO)", (it) => {
    it.effect("status filter + ORDER BY created_at ASC", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        const first = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        const second = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          entitlementId: ids.entitlementId,
        })
        // Move first to approved so it falls out of the listPending result.
        yield* repo.updateStatus(first.id, "approved")

        const pending = yield* repo.listPending()
        expect(pending.map((r) => r.id)).toEqual([second.id])
      }),
    )
  })

  it.layer(TestLayer)("listPending filters by applicationId", (it) => {
    it.effect("only the matching app's pending row", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-other', 'other', 'Other', 'request', 'p-requester')`
        yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
                   VALUES ('role-other', 'app-other', 'viewer', 'Viewer')`

        yield* repo.create({ requesterId: ids.requesterId, applicationId: ids.applicationId, roleId: ids.roleId })
        yield* repo.create({ requesterId: ids.requesterId, applicationId: "app-other", roleId: "role-other" })

        const filtered = yield* repo.listPending(ids.applicationId)
        expect(filtered).toHaveLength(1)
        expect(filtered[0].applicationId).toBe(ids.applicationId)
      }),
    )
  })

  it.layer(TestLayer)("listForRequester returns rows ORDER BY created_at DESC", (it) => {
    it.effect("scoped to requester, newest first", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        // Distinct (role, entitlement) tuples — there's a UNIQUE INDEX on
        // pending requests for (requester, app, role, entitlement) so we can't
        // file two identical pending requests at once.
        yield* repo.create({ requesterId: ids.requesterId, applicationId: ids.applicationId, roleId: ids.roleId })
        yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          entitlementId: ids.entitlementId,
        })

        const mine = yield* repo.listForRequester(ids.requesterId)
        expect(mine).toHaveLength(2)

        const empty = yield* repo.listForRequester("no-such-user")
        expect(empty).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("listForRequesterEnriched surfaces app/role/entitlement display names", (it) => {
    it.effect("JOIN populates the enriched fields", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          entitlementId: ids.entitlementId,
        })

        const rows = yield* repo.listForRequesterEnriched(ids.requesterId)
        expect(rows).toHaveLength(2)
        const roleRow = rows.find((r) => r.roleId === ids.roleId)!
        expect(roleRow.applicationName).toBe("AR App")
        expect(roleRow.applicationSlug).toBe("ar")
        expect(roleRow.roleName).toBe("Editor")
        expect(roleRow.entitlementName).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("listAll honors status / applicationId / limit / offset", (it) => {
    it.effect("all four filter axes", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll
        const sql = yield* SqlClient.SqlClient
        // Distinct targets so the pending-uniq index allows 3 simultaneous pending rows.
        yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
                   VALUES ('role-viewer', 'app-ar', 'viewer', 'Viewer')`
        yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
                   VALUES ('ent-view', 'app-ar', 'view', 'View')`

        const a = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        const b = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: "role-viewer",
        })
        const c = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          entitlementId: "ent-view",
        })
        yield* repo.updateStatus(a.id, "approved")

        // status filter
        const approved = yield* repo.listAll({ status: "approved" })
        expect(approved.map((r) => r.id)).toEqual([a.id])

        // limit / offset (DESC order, so newest first: c, b)
        const page1 = yield* repo.listAll({ status: "pending", limit: 1 })
        expect(page1).toHaveLength(1)
        const page2 = yield* repo.listAll({ status: "pending", limit: 1, offset: 1 })
        expect(page2).toHaveLength(1)
        expect(page1[0].id).not.toBe(page2[0].id)

        // applicationId filter (only matching app)
        const byApp = yield* repo.listAll({ applicationId: ids.applicationId })
        expect(byApp.map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort())

        const otherApp = yield* repo.listAll({ applicationId: "nonexistent" })
        expect(otherApp).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("listAllEnriched surfaces requesterName + applicationName", (it) => {
    it.effect("admin-view fields are populated", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })

        const rows = yield* repo.listAllEnriched()
        expect(rows).toHaveLength(1)
        expect(rows[0].requesterName).toBe("Requester")
        expect(rows[0].applicationName).toBe("AR App")
        expect(rows[0].roleName).toBe("Editor")
      }),
    )
  })

  it.layer(TestLayer)("findByIdEnriched returns null when missing", (it) => {
    it.effect("missing id", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const found = yield* repo.findByIdEnriched("nope")
        expect(found).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("findByIdEnriched returns the enriched row", (it) => {
    it.effect("returns joined names", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll
        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          entitlementId: ids.entitlementId,
        })

        const found = yield* repo.findByIdEnriched(req.id)
        expect(found?.id).toBe(req.id)
        expect(found?.applicationName).toBe("AR App")
        expect(found?.entitlementName).toBe("Edit")
        expect(found?.roleName).toBeNull()
        expect(found?.requesterName).toBe("Requester")
      }),
    )
  })
})

describe("AccessRequestRepo — approvals + state transitions", () => {
  it.layer(TestLayer)("createApprovalRecords + getApprovals", (it) => {
    it.effect("records one row per approver", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll
        const sql = yield* SqlClient.SqlClient
        // Second approver
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-approver-2', 'user', 'app2', 'Approver 2', 'app2@example.com')`

        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        yield* repo.createApprovalRecords(req.id, [ids.approverId, "p-approver-2"])

        const approvals = yield* repo.getApprovals(req.id)
        expect(approvals).toHaveLength(2)
        expect(approvals.map((a) => a.approverId).sort()).toEqual(["p-approver", "p-approver-2"].sort())
      }),
    )
  })

  it.layer(TestLayer)("recordDecision updates an approver's row", (it) => {
    it.effect("decision + comment are persisted", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        yield* repo.createApprovalRecords(req.id, [ids.approverId])
        yield* repo.recordDecision(req.id, ids.approverId, "approved", "lgtm")

        const approvals = yield* repo.getApprovals(req.id)
        expect(approvals[0].decision).toBe("approved")
        expect(approvals[0].comment).toBe("lgtm")
        expect(approvals[0].decidedAt).not.toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("updateStatus sets resolved_at on terminal states only", (it) => {
    it.effect("approved sets resolved_at; pending does not", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        // Approved → resolved_at set
        yield* repo.updateStatus(req.id, "approved")
        const afterApprove = yield* repo.findById(req.id)
        expect(afterApprove?.status).toBe("approved")
        expect(afterApprove?.resolvedAt).not.toBeNull()

        // Move back to pending — resolved_at is preserved (the CASE leaves it alone)
        yield* repo.updateStatus(req.id, "pending")
        const afterReset = yield* repo.findById(req.id)
        expect(afterReset?.status).toBe("pending")
        expect(afterReset?.resolvedAt).not.toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("linkGrant writes grant_id on the request", (it) => {
    it.effect("grant_id surfaces via findById", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll
        const sql = yield* SqlClient.SqlClient
        // Need a real grant row because grant_id is a FK.
        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by)
                   VALUES ('grant-1', ${ids.requesterId}, ${ids.roleId}, ${ids.approverId})`

        const req = yield* repo.create({
          requesterId: ids.requesterId,
          applicationId: ids.applicationId,
          roleId: ids.roleId,
        })
        yield* repo.linkGrant(req.id, "grant-1")

        const found = yield* repo.findById(req.id)
        expect(found?.grantId).toBe("grant-1")
      }),
    )
  })
})

describe("AccessRequestRepo — approval policy resolution", () => {
  it.layer(TestLayer)("findApprovalPolicy prefers entitlement scope over role over application", (it) => {
    it.effect("most-specific match wins", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll
        const sql = yield* SqlClient.SqlClient
        // Seed three layered policies on the same app. The schema is
        // (scope_type, scope_id, mode, rules) — this test only cares about
        // which row resolves, not the policy content.
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, scope_id, mode, rules)
                   VALUES ('pol-app', ${ids.applicationId}, 'application', NULL, 'one_of', '[]'::jsonb)`
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, scope_id, mode, rules)
                   VALUES ('pol-role', ${ids.applicationId}, 'role', ${ids.roleId}, 'one_of', '[]'::jsonb)`
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, scope_id, mode, rules)
                   VALUES ('pol-ent', ${ids.applicationId}, 'entitlement', ${ids.entitlementId}, 'one_of', '[]'::jsonb)`

        const ent = yield* repo.findApprovalPolicy(ids.applicationId, ids.roleId, ids.entitlementId)
        expect(ent?.id).toBe("pol-ent")

        const role = yield* repo.findApprovalPolicy(ids.applicationId, ids.roleId, undefined)
        expect(role?.id).toBe("pol-role")

        const app = yield* repo.findApprovalPolicy(ids.applicationId, undefined, undefined)
        expect(app?.id).toBe("pol-app")
      }),
    )
  })

  it.layer(TestLayer)("findApprovalPolicy returns null when no policy registered", (it) => {
    it.effect("missing policy → null", () =>
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        const ids = yield* seedAll

        const policy = yield* repo.findApprovalPolicy(ids.applicationId, ids.roleId)
        expect(policy).toBeNull()
      }),
    )
  })
})
