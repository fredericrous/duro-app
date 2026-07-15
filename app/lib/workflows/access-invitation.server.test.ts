// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import {
  acceptInvitation,
  declineInvitation,
  cancelInvitation,
  notifyInviteeOfInvitation,
} from "./access-invitation.server"
import { AccessInvitationRepo, AccessInvitationRepoLive } from "~/lib/governance/AccessInvitationRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { DiscordNotifier } from "~/lib/services/DiscordNotifier.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { ProvisioningService } from "~/lib/governance/ProvisioningService.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"

const MockAudit = Layer.succeed(AuditService, { emit: () => Effect.void, query: () => Effect.succeed([]) } as any)
const MockDiscord = Layer.succeed(DiscordNotifier, { notify: () => Effect.void })
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

const emailCalls: Array<{ to: string; subject: string }> = []
const CapturingEmail = Layer.succeed(EmailService, {
  sendInviteEmail: () => Effect.succeed(""),
  sendCertRenewalEmail: () => Effect.void,
  sendRecoveryNotificationEmail: () => Effect.void,
  sendNotificationEmail: (to: string, subject: string) => Effect.sync(() => void emailCalls.push({ to, subject })),
})

const TestLayer = Layer.mergeAll(
  AccessInvitationRepoLive,
  GrantRepoLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  MockAudit,
  MockDiscord,
  MockProvisioning,
  MockPluginHost,
  CapturingEmail,
).pipe(Layer.provideMerge(makeTestDbLayer()))

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const inviteeId = "p-invitee"
  const adminId = "p-admin"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${inviteeId}, 'user', 'invitee', 'Invitee', 'invitee@example.com')`
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${adminId}, 'user', 'admin', 'Admin', 'admin@example.com')`
  const appId = "app-inv-test"
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES (${appId}, 'inv-app', 'Invite App', 'invite_only', ${adminId})`
  const roleId = "role-inv-viewer"
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES (${roleId}, ${appId}, 'viewer', 'Viewer')`
  return { inviteeId, adminId, appId, roleId }
})

const createInvitation = (input: {
  appId: string
  roleId: string
  inviteeId: string
  adminId: string
  expiresAt?: string
}) =>
  Effect.gen(function* () {
    const repo = yield* AccessInvitationRepo
    return yield* repo.create({
      applicationId: input.appId,
      roleId: input.roleId,
      invitedPrincipalId: input.inviteeId,
      invitedBy: input.adminId,
      expiresAt: input.expiresAt,
    })
  })

describe("acceptInvitation", () => {
  it.layer(TestLayer)("mints the grant and marks the invitation accepted", (it) => {
    it.effect("creates exactly one grant and links it", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation(ids)

        const out = yield* acceptInvitation({ invitationId: inv.id, principalId: ids.inviteeId })
        expect(out.grantId).toBeTruthy()

        const rows = yield* sql`SELECT status, grant_id FROM access_invitations WHERE id = ${inv.id}`
        expect((rows[0] as any).status).toBe("accepted")
        expect((rows[0] as any).grantId).toBe(out.grantId)

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.inviteeId} AND role_id = ${ids.roleId}`
        expect(grants.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("is idempotent — a second accept does not create a second grant", (it) => {
    it.effect("second accept fails, one grant remains", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation(ids)

        yield* acceptInvitation({ invitationId: inv.id, principalId: ids.inviteeId })
        const second = yield* Effect.exit(acceptInvitation({ invitationId: inv.id, principalId: ids.inviteeId }))
        expect(second._tag).toBe("Failure")

        const grants =
          yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.inviteeId} AND role_id = ${ids.roleId}`
        expect(grants.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("rejects acceptance by a principal other than the invitee", (it) => {
    it.effect("fails with not_yours and grants nothing", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation(ids)

        const exit = yield* Effect.exit(acceptInvitation({ invitationId: inv.id, principalId: ids.adminId }))
        expect(exit._tag).toBe("Failure")

        const rows = yield* sql`SELECT status FROM access_invitations WHERE id = ${inv.id}`
        expect((rows[0] as any).status).toBe("pending")
        const grants = yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.adminId}`
        expect(grants.length).toBe(0)
      }),
    )
  })

  it.layer(TestLayer)("rejects and expires an invitation past its expiry", (it) => {
    it.effect("fails and marks the invitation expired", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation({ ...ids, expiresAt: new Date(Date.now() - 60_000).toISOString() })

        const exit = yield* Effect.exit(acceptInvitation({ invitationId: inv.id, principalId: ids.inviteeId }))
        expect(exit._tag).toBe("Failure")

        const rows = yield* sql`SELECT status FROM access_invitations WHERE id = ${inv.id}`
        expect((rows[0] as any).status).toBe("expired")
        const grants = yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.inviteeId}`
        expect(grants.length).toBe(0)
      }),
    )
  })
})

describe("declineInvitation / cancelInvitation", () => {
  it.layer(TestLayer)("declining marks it declined and grants nothing", (it) => {
    it.effect("status becomes declined", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation(ids)

        yield* declineInvitation({ invitationId: inv.id, principalId: ids.inviteeId })

        const rows = yield* sql`SELECT status FROM access_invitations WHERE id = ${inv.id}`
        expect((rows[0] as any).status).toBe("declined")
        const grants = yield* sql`SELECT id FROM grants WHERE principal_id = ${ids.inviteeId}`
        expect(grants.length).toBe(0)
      }),
    )
  })

  it.layer(TestLayer)("a non-invitee cannot decline someone else's invitation", (it) => {
    it.effect("fails and leaves it pending", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation(ids)

        const exit = yield* Effect.exit(declineInvitation({ invitationId: inv.id, principalId: ids.adminId }))
        expect(exit._tag).toBe("Failure")
        const rows = yield* sql`SELECT status FROM access_invitations WHERE id = ${inv.id}`
        expect((rows[0] as any).status).toBe("pending")
      }),
    )
  })

  it.layer(TestLayer)("admin cancel retracts a pending invitation", (it) => {
    it.effect("status leaves pending", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const inv = yield* createInvitation(ids)

        yield* cancelInvitation({ invitationId: inv.id, adminPrincipalId: ids.adminId })

        const rows = yield* sql`SELECT status FROM access_invitations WHERE id = ${inv.id}`
        expect((rows[0] as any).status).not.toBe("pending")
      }),
    )
  })
})

describe("markExpired", () => {
  it.layer(TestLayer)("bulk-expires only past-due pending invitations", (it) => {
    it.effect("expires the stale one, leaves the fresh one", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        const sql = yield* SqlClient.SqlClient
        const stale = yield* createInvitation({ ...ids, expiresAt: new Date(Date.now() - 60_000).toISOString() })
        const fresh = yield* createInvitation({ ...ids, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })

        const repo = yield* AccessInvitationRepo
        const n = yield* repo.markExpired()
        expect(n).toBe(1)

        const staleRow = yield* sql`SELECT status FROM access_invitations WHERE id = ${stale.id}`
        const freshRow = yield* sql`SELECT status FROM access_invitations WHERE id = ${fresh.id}`
        expect((staleRow[0] as any).status).toBe("expired")
        expect((freshRow[0] as any).status).toBe("pending")
      }),
    )
  })
})

describe("notifyInviteeOfInvitation", () => {
  it.layer(TestLayer)("emails the invited principal about the invitation", (it) => {
    it.effect("captures an email to the invitee with the app name", () =>
      Effect.gen(function* () {
        const ids = yield* seed
        emailCalls.length = 0
        yield* notifyInviteeOfInvitation({ invitedPrincipalId: ids.inviteeId, applicationId: ids.appId })
        expect(emailCalls.length).toBe(1)
        expect(emailCalls[0].to).toBe("invitee@example.com")
        expect(emailCalls[0].subject).toContain("Invite App")
      }),
    )
  })

  it.layer(TestLayer)("is a silent no-op when the invitee has no email", (it) => {
    it.effect("sends nothing", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO principals (id, principal_type, display_name) VALUES ('p-noemail', 'user', 'No Email')`
        yield* sql`INSERT INTO principals (id, principal_type, display_name, email)
                   VALUES ('p-admin2', 'user', 'Admin2', 'admin2@x')`
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-noemail', 'a2', 'App2', 'invite_only', 'p-admin2')`
        emailCalls.length = 0
        yield* notifyInviteeOfInvitation({ invitedPrincipalId: "p-noemail", applicationId: "app-noemail" })
        expect(emailCalls.length).toBe(0)
      }),
    )
  })
})
