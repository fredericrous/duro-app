import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { handleAdminAccessRequestsMutation } from "./admin-access-requests"
import { submitAccessRequest } from "~/lib/workflows/access-request.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { AuditServiceLive } from "~/lib/governance/AuditService.server"
import { ProvisioningService } from "~/lib/governance/ProvisioningService.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"

// Use the live AuditService so we can assert that the right event_type lands
// in the audit_events table — the original C1 bug was that the route wrote
// nothing to audit because it bypassed the workflow.
const MockProvisioning = Layer.succeed(ProvisioningService, {
  onGrantActivated: () => Effect.succeed([] as string[]),
  onGrantRevoked: () => Effect.succeed([] as string[]),
  processNextPending: () => Effect.void,
  processJob: () => Effect.void,
} as any)

const MockPluginHost = Layer.succeed(PluginHost, {
  runProvision: () => Effect.void,
  runDeprovision: () => Effect.void,
} as any)

const TestLayer = Layer.mergeAll(
  AccessRequestRepoLive,
  GrantRepoLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  ConnectedSystemRepoLive,
  ConnectorMappingRepoLive,
  AuditServiceLive,
  MockProvisioning,
  MockPluginHost,
).pipe(Layer.provideMerge(makeTestDbLayer()))

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const requesterId = "p-requester"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${requesterId}, 'user', 'requester', 'Requester', 'r@example.com')`

  const approverId = "p-approver"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${approverId}, 'user', 'approver', 'Approver', 'a@example.com')`

  const appId = "app-mut"
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES (${appId}, 'mut-app', 'Mut App', 'request', ${approverId})`

  const roleId = "role-mut-viewer"
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES (${roleId}, ${appId}, 'viewer', 'Viewer')`

  // one_of policy with app_owner so submit returns "pending" (otherwise
  // submit would auto-approve and we'd have no pending request to test on).
  yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
             VALUES (
               'policy-mut',
               ${appId},
               'application',
               'one_of',
               ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb
             )`

  const submitted = yield* submitAccessRequest({ requesterId, applicationId: appId, roleId })
  return { requesterId, approverId, appId, roleId, requestId: submitted.requestId }
})

describe("handleAdminAccessRequestsMutation", () => {
  it.layer(TestLayer)("approve creates a grant, flips status, emits audit", (it) => {
    it.effect("end-to-end loop is wired correctly", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient

        const result = yield* handleAdminAccessRequestsMutation({
          intent: "approve",
          requestId: ids.requestId,
          approverId: ids.approverId,
          comment: "looks good",
        })

        expect("success" in result && result.success).toBe(true)

        const rows = yield* sql`SELECT status FROM access_requests WHERE id = ${ids.requestId}`
        expect((rows[0] as { status: string }).status).toBe("approved")

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId} AND revoked_at IS NULL`
        expect(grants.length).toBe(1)

        const audits =
          yield* sql`SELECT event_type FROM audit_events WHERE target_id = ${ids.requestId} ORDER BY created_at`
        const types = audits.map((a) => (a as { eventType: string }).eventType)
        // submit emits "access.requested"; approve emits "access.approved".
        expect(types).toContain("access.requested")
        expect(types).toContain("access.approved")
      }),
    )
  })

  it.layer(TestLayer)("reject flips status, no grant, emits rejected audit", (it) => {
    it.effect("rejection path", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient

        const result = yield* handleAdminAccessRequestsMutation({
          intent: "reject",
          requestId: ids.requestId,
          approverId: ids.approverId,
          comment: "not now",
        })
        expect("success" in result && result.success).toBe(true)

        const rows = yield* sql`SELECT status FROM access_requests WHERE id = ${ids.requestId}`
        expect((rows[0] as { status: string }).status).toBe("rejected")

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId} AND revoked_at IS NULL`
        expect(grants.length).toBe(0)

        const audits = yield* sql`SELECT event_type FROM audit_events WHERE target_id = ${ids.requestId}`
        const types = audits.map((a) => (a as { eventType: string }).eventType)
        expect(types).toContain("access.rejected")
      }),
    )
  })

  it.layer(TestLayer)("cancel marks status cancelled, no grant", (it) => {
    it.effect("cancel path", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient

        const result = yield* handleAdminAccessRequestsMutation({
          intent: "cancel",
          requestId: ids.requestId,
        })
        expect("success" in result && result.success).toBe(true)

        const rows = yield* sql`SELECT status FROM access_requests WHERE id = ${ids.requestId}`
        expect((rows[0] as { status: string }).status).toBe("cancelled")

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId} AND revoked_at IS NULL`
        expect(grants.length).toBe(0)
      }),
    )
  })

  it.layer(TestLayer)("a non-approver cannot flip status to 'approved' (regression for C2)", (it) => {
    it.effect("decisions from anyone outside the approval set are ignored", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient

        // The C2 bug passed the OIDC username string ("alice") through as the
        // approverId. recordDecision is an UPDATE keyed on approver_id, so a
        // wrong id matches zero rows and the policy never sees an approval —
        // the request must stay pending. If a future regression tries to
        // create an approval row on the fly (or short-circuits on missing
        // matches), this test catches it.
        const result = yield* handleAdminAccessRequestsMutation({
          intent: "approve",
          requestId: ids.requestId,
          approverId: "alice",
          comment: "should be a no-op",
        })

        // Dispatcher itself doesn't FK-violate — it returns success — but the
        // important invariant is the persisted state.
        expect("success" in result).toBe(true)

        const rows = yield* sql`SELECT status FROM access_requests WHERE id = ${ids.requestId}`
        expect((rows[0] as { status: string }).status).toBe("pending")

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId} AND revoked_at IS NULL`
        expect(grants.length).toBe(0)

        // No "access.approved" audit row was emitted.
        const audits =
          yield* sql`SELECT event_type FROM audit_events WHERE target_id = ${ids.requestId} AND event_type = 'access.approved'`
        expect(audits.length).toBe(0)
      }),
    )
  })
})
