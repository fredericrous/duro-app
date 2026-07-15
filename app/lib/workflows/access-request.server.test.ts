// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import {
  evaluatePolicy,
  submitAccessRequest,
  decideApproval,
  cancelOwnAccessRequest,
  MissingRoleOrEntitlementError,
  BothRoleAndEntitlementError,
  RoleEntitlementAppMismatchError,
  AccessRequestNotOwnedError,
  AccessRequestNotCancellableError,
} from "./access-request.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { ProvisioningService } from "~/lib/governance/ProvisioningService.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { DiscordNotifier } from "~/lib/services/DiscordNotifier.server"
import { EmailService } from "~/lib/services/EmailService.server"

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
  onGrantActivated: () => Effect.succeed([] as string[]),
  onGrantRevoked: () => Effect.succeed([] as string[]),
  processNextPending: () => Effect.void,
  processJob: () => Effect.void,
} as any)

const MockPluginHost = Layer.succeed(PluginHost, {
  runProvision: () => Effect.void,
  runDeprovision: () => Effect.void,
} as any)

// Capturing DiscordNotifier — the workflow now requires it. Assertions read the
// module-level array; tests that check it reset it first (discordCalls.length = 0).
const discordCalls: string[] = []
const CapturingDiscord = Layer.succeed(DiscordNotifier, {
  notify: (content: string) => Effect.sync(() => void discordCalls.push(content)),
})

// Capturing EmailService — decideApproval now emails the requester on a final
// decision. Records (to, subject) so tests can assert who was notified.
const emailCalls: Array<{ to: string; subject: string }> = []
const CapturingEmail = Layer.succeed(EmailService, {
  sendInviteEmail: () => Effect.succeed(""),
  sendCertRenewalEmail: () => Effect.void,
  sendRecoveryNotificationEmail: () => Effect.void,
  sendNotificationEmail: (to: string, subject: string) => Effect.sync(() => void emailCalls.push({ to, subject })),
})

const TestLayer = Layer.mergeAll(
  AccessRequestRepoLive,
  GrantRepoLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  ConnectedSystemRepoLive,
  ConnectorMappingRepoLive,
  MockAudit,
  MockProvisioning,
  MockPluginHost,
  CapturingDiscord,
  CapturingEmail,
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

describe("submitAccessRequest validation", () => {
  it.layer(TestLayer)("rejects when neither role nor entitlement is supplied", (it) => {
    it.effect("fails with MissingRoleOrEntitlementError", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const exit = yield* Effect.exit(submitAccessRequest({ requesterId: ids.requesterId, applicationId: ids.appId }))
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          const failure = exit.cause as { _tag: string; error?: unknown }
          const err = (failure as any).error ?? (failure as any).failure
          expect(err).toBeInstanceOf(MissingRoleOrEntitlementError)
        }
      }),
    )
  })

  it.layer(TestLayer)("rejects when both role and entitlement are supplied", (it) => {
    it.effect("fails with BothRoleAndEntitlementError", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const exit = yield* Effect.exit(
          submitAccessRequest({
            requesterId: ids.requesterId,
            applicationId: ids.appId,
            roleId: ids.roleId,
            entitlementId: ids.entitlementId,
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          const failure = exit.cause as { _tag: string; error?: unknown }
          const err = (failure as any).error ?? (failure as any).failure
          expect(err).toBeInstanceOf(BothRoleAndEntitlementError)
        }
      }),
    )
  })

  it.layer(TestLayer)("rejects when role belongs to a different app", (it) => {
    it.effect("fails with RoleEntitlementAppMismatchError", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient
        // A second application with no roles linked back to the first.
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-other', 'other-app', 'Other App', 'request', ${ids.approverId})`

        const exit = yield* Effect.exit(
          submitAccessRequest({
            requesterId: ids.requesterId,
            applicationId: "app-other",
            roleId: ids.roleId, // belongs to ids.appId, not 'app-other'
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          const failure = exit.cause as { _tag: string; error?: unknown }
          const err = (failure as any).error ?? (failure as any).failure
          expect(err).toBeInstanceOf(RoleEntitlementAppMismatchError)
        }
      }),
    )
  })

  it.layer(TestLayer)("dedups a second pending request for the same target", (it) => {
    it.effect("returns status 'duplicate' with the existing requestId", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        // Force a pending status: install a one_of policy so the request stays pending.
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                   VALUES (
                     'policy-dup',
                     ${ids.appId},
                     'application',
                     'one_of',
                     ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb
                   )`

        const first = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(first.status).toBe("pending")

        const second = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(second.status).toBe("duplicate")
        expect(second.requestId).toBe(first.requestId)

        const rows = yield* sql`SELECT count(*)::int AS n FROM access_requests
                                WHERE requester_id = ${ids.requesterId}
                                  AND application_id = ${ids.appId}
                                  AND role_id = ${ids.roleId}
                                  AND status = 'pending'`
        expect((rows[0] as any).n).toBe(1)
      }),
    )
  })
})

describe("cancelOwnAccessRequest", () => {
  it.layer(TestLayer)("cancels a pending request owned by the caller", (it) => {
    it.effect("flips status to cancelled", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                   VALUES (
                     'policy-cancel',
                     ${ids.appId},
                     'application',
                     'one_of',
                     ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb
                   )`

        const submitted = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(submitted.status).toBe("pending")

        const result = yield* cancelOwnAccessRequest({
          requestId: submitted.requestId,
          requesterId: ids.requesterId,
        })
        expect(result.status).toBe("cancelled")

        const rows = yield* sql`SELECT status FROM access_requests WHERE id = ${submitted.requestId}`
        expect((rows[0] as any).status).toBe("cancelled")
      }),
    )
  })

  it.layer(TestLayer)("rejects when the caller is not the requester", (it) => {
    it.effect("fails with AccessRequestNotOwnedError", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                   VALUES (
                     'policy-cancel-2',
                     ${ids.appId},
                     'application',
                     'one_of',
                     ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb
                   )`

        const submitted = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })

        const exit = yield* Effect.exit(
          cancelOwnAccessRequest({
            requestId: submitted.requestId,
            requesterId: ids.approverId, // wrong owner
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          const failure = exit.cause as { _tag: string; error?: unknown }
          const err = (failure as any).error ?? (failure as any).failure
          expect(err).toBeInstanceOf(AccessRequestNotOwnedError)
        }

        // Status must be untouched.
        const rows = yield* sql`SELECT status FROM access_requests WHERE id = ${submitted.requestId}`
        expect((rows[0] as any).status).toBe("pending")
      }),
    )
  })

  it.layer(TestLayer)("rejects when the request is not pending", (it) => {
    it.effect("fails with AccessRequestNotCancellableError", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData

        // No approval policy → auto-approves on submit.
        const submitted = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(submitted.status).toBe("approved")

        const exit = yield* Effect.exit(
          cancelOwnAccessRequest({
            requestId: submitted.requestId,
            requesterId: ids.requesterId,
          }),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          const failure = exit.cause as { _tag: string; error?: unknown }
          const err = (failure as any).error ?? (failure as any).failure
          expect(err).toBeInstanceOf(AccessRequestNotCancellableError)
        }
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

  it.layer(TestLayer)("approving an already-approved request does not create a second grant", (it) => {
    it.effect("is idempotent — a duplicate approve is a no-op", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES ('policy-idem', ${ids.appId}, 'application', 'one_of',
                       ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb)`

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("pending")

        // Two approvals for the same request (double-submit / second approver).
        yield* decideApproval({ requestId: result.requestId, approverId: ids.approverId, decision: "approved" })
        yield* decideApproval({ requestId: result.requestId, approverId: ids.approverId, decision: "approved" })

        // Exactly one grant — the status guard must prevent a second.
        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId}`
        expect(grants.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("auto-approves and grants when a policy resolves zero approvers", (it) => {
    it.effect("creates the grant instead of approving with nothing granted", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        // A 'principal' rule with no approverPrincipalId resolves to zero
        // approvers — the branch that previously marked the request approved
        // without ever creating a grant.
        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES ('policy-noapprovers', ${ids.appId}, 'application', 'one_of',
                       ${JSON.stringify([{ approverType: "principal" }])}::jsonb)`

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("approved")

        const requests = yield* sql`SELECT status FROM access_requests WHERE id = ${result.requestId}`
        expect((requests[0] as any).status).toBe("approved")

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.requesterId} AND role_id = ${ids.roleId}`
        expect(grants.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("notifies Discord that the request was approved", (it) => {
    it.effect("captures an 'approved' message for the request + application", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES ('policy-notify-approve', ${ids.appId}, 'application', 'one_of',
                       ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb)`

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("pending")

        discordCalls.length = 0
        emailCalls.length = 0
        yield* decideApproval({
          requestId: result.requestId,
          approverId: ids.approverId,
          decision: "approved",
        })

        expect(discordCalls.length).toBe(1)
        expect(discordCalls[0]).toContain(result.requestId)
        expect(discordCalls[0]).toContain(ids.appId)
        expect(discordCalls[0]).toContain("approved")

        // The requester is also emailed directly (Discord only hits the shared
        // channel). seedTestData gives the requester an email.
        expect(emailCalls.length).toBe(1)
        expect(emailCalls[0].to).toBe("requester@example.com")
        expect(emailCalls[0].subject.toLowerCase()).toContain("approved")
      }),
    )
  })

  it.layer(TestLayer)("notifies Discord that the request was rejected", (it) => {
    it.effect("captures a 'rejected' message when the decision resolves to rejected", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES ('policy-notify-reject', ${ids.appId}, 'application', 'one_of',
                       ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb)`

        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("pending")

        discordCalls.length = 0
        yield* decideApproval({
          requestId: result.requestId,
          approverId: ids.approverId,
          decision: "rejected",
        })

        // A single app_owner approver rejecting a one_of policy → rejected.
        const requests = yield* sql`SELECT status FROM access_requests WHERE id = ${result.requestId}`
        expect((requests[0] as any).status).toBe("rejected")

        expect(discordCalls.length).toBe(1)
        expect(discordCalls[0]).toContain(result.requestId)
        expect(discordCalls[0]).toContain("rejected")
      }),
    )
  })
})

describe("submitAccessRequest notifications", () => {
  it.layer(TestLayer)("pings Discord about a new pending request when a policy applies", (it) => {
    it.effect("captures a 'pending review' admin message", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
                     VALUES ('policy-notify-pending', ${ids.appId}, 'application', 'one_of',
                       ${JSON.stringify([{ approverType: "app_owner" }])}::jsonb)`

        discordCalls.length = 0
        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("pending")

        expect(discordCalls.length).toBe(1)
        expect(discordCalls[0]).toContain("pending review")
        expect(discordCalls[0]).toContain(ids.appId)
      }),
    )
  })

  it.layer(TestLayer)("does NOT ping Discord on the auto-approve path", (it) => {
    it.effect("no pending-review notification when the request is auto-approved", () =>
      Effect.gen(function* () {
        const ids = yield* seedTestData

        // No approval policy → auto-approve; no pending-review notification.
        discordCalls.length = 0
        const result = yield* submitAccessRequest({
          requesterId: ids.requesterId,
          applicationId: ids.appId,
          roleId: ids.roleId,
        })
        expect(result.status).toBe("approved")

        expect(discordCalls.some((c) => c.includes("pending review"))).toBe(false)
      }),
    )
  })
})
