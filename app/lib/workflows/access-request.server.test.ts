import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { evaluatePolicy, submitAccessRequest, decideApproval } from "./access-request.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { ProvisioningService } from "~/lib/governance/ProvisioningService.server"

// ---------------------------------------------------------------------------
// Section 1: Unit tests for evaluatePolicy (pure function)
// ---------------------------------------------------------------------------

describe("evaluatePolicy", () => {
  it("mode 'none' always returns 'approved' regardless of approvals", () => {
    expect(evaluatePolicy("none", [])).toBe("approved")
    expect(evaluatePolicy("none", [{ decision: null }, { decision: "rejected" }])).toBe("approved")
  })

  it("mode 'one_of' returns 'approved' if at least one approval", () => {
    expect(evaluatePolicy("one_of", [{ decision: "approved" }, { decision: null }])).toBe("approved")
  })

  it("mode 'one_of' returns 'rejected' if all rejected", () => {
    expect(evaluatePolicy("one_of", [{ decision: "rejected" }, { decision: "rejected" }])).toBe("rejected")
  })

  it("mode 'one_of' returns 'pending' if some are undecided", () => {
    expect(evaluatePolicy("one_of", [{ decision: null }, { decision: null }])).toBe("pending")
    expect(evaluatePolicy("one_of", [{ decision: "rejected" }, { decision: null }])).toBe("pending")
  })

  it("mode 'all_of' returns 'approved' only when ALL approved", () => {
    expect(evaluatePolicy("all_of", [{ decision: "approved" }, { decision: "approved" }])).toBe("approved")
  })

  it("mode 'all_of' returns 'rejected' if any rejected", () => {
    expect(evaluatePolicy("all_of", [{ decision: "approved" }, { decision: "rejected" }])).toBe("rejected")
  })

  it("mode 'all_of' returns 'pending' if some undecided, none rejected", () => {
    expect(evaluatePolicy("all_of", [{ decision: "approved" }, { decision: null }])).toBe("pending")
  })

  it("unknown mode returns 'pending'", () => {
    expect(evaluatePolicy("unknown_mode", [{ decision: "approved" }])).toBe("pending")
  })
})

// ---------------------------------------------------------------------------
// Section 2: Integration tests for submitAccessRequest / decideApproval
// ---------------------------------------------------------------------------

const MockAudit = Layer.succeed(AuditService, {
  emit: () => Effect.void,
  query: () => Effect.succeed([]),
} as any)

const MockProvisioning = Layer.succeed(ProvisioningService, {
  onGrantActivated: () => Effect.void,
  onGrantRevoked: () => Effect.void,
  processNextPending: () => Effect.void,
  processJob: () => Effect.void,
} as any)

const TestLayer = Layer.mergeAll(
  AccessRequestRepoLive,
  GrantRepoLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  MockAudit,
  MockProvisioning,
).pipe(Layer.provideMerge(makeTestDbLayer()))

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------

const seedTestData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Requester principal
  const requesterId = "p-requester"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${requesterId}, 'user', 'requester', 'Requester', 'requester@example.com')`

  // Approver principal
  const approverId = "p-approver"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${approverId}, 'user', 'approver', 'Approver', 'approver@example.com')`

  // Application (owner is the approver)
  const appId = "app-req-test"
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES (${appId}, 'req-test-app', 'Request Test App', 'request', ${approverId})`

  // Role
  const roleId = "role-req-viewer"
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES (${roleId}, ${appId}, 'viewer', 'Viewer')`

  // Entitlement
  const entitlementId = "ent-req-read"
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES (${entitlementId}, ${appId}, 'read', 'Read')`

  // Role-entitlement mapping
  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id)
             VALUES (${roleId}, ${entitlementId})`

  return { requesterId, approverId, appId, roleId, entitlementId }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitAccessRequest", () => {
  it.layer(TestLayer)("auto-approves when no approval policy exists", (it) => {
    it.effect("returns approved and creates a grant", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })

        expect(result.status).toBe("approved")

        // Verify a grant was created
        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId}`
        expect(grants.length).toBeGreaterThanOrEqual(1)
      }),
    )
  })

  it.layer(TestLayer)("creates pending request when approval policy exists with mode one_of", (it) => {
    it.effect("returns pending status", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        // Insert an approval policy with mode "one_of"
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES (
                       'policy-one-of',
                       ${ids.appId},
                       'application',
                       'one_of',
                       ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb
                     )`

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })

        expect(result.status).toBe("pending")
      }),
    )
  })

  it.layer(TestLayer)("auto-approves when policy mode is none", (it) => {
    it.effect("returns approved status", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        // Insert an approval policy with mode "none"
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES (
                       'policy-none',
                       ${ids.appId},
                       'application',
                       'none',
                       '[]'::jsonb
                     )`

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })

        expect(result.status).toBe("approved")
      }),
    )
  })
})

describe("decideApproval", () => {
  it.layer(TestLayer)("approving a pending request creates a grant", (it) => {
    it.effect("updates status to approved and creates grant", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        // Insert an approval policy with mode "one_of"
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES (
                       'policy-decide',
                       ${ids.appId},
                       'application',
                       'one_of',
                       ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb
                     )`

        // Submit the request (will be pending)
        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("pending")

        // Approve the request
        yield* decideApproval({
          requestId: result.requestId,
          approverId: ids.approverId,
          decision: "approved",
          comment: "Looks good",
        })

        // Verify request status is now approved
        const requests = yield* sql`SELECT status FROM access_requests WHERE id = ${result.requestId}`
        expect(requests.length).toBe(1)
        expect((requests[0] as any).status).toBe("approved")

        // Verify a grant was created
        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId}`
        expect(grants.length).toBeGreaterThanOrEqual(1)
      }),
    )
  })
})
