import { Effect, Schema } from "effect"
import { Workflow, Activity } from "@effect/workflow"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { GitHubClient } from "~/lib/services/GitHubClient.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { EventBroker } from "~/lib/services/EventBroker.server"

export interface InviteInput {
  email: string
  groups: number[]
  groupNames: string[]
  invitedBy: string
}

export interface AcceptInput {
  username: string
  password: string
}

// --- Error type for workflow activities ---

class InviteWorkflowError extends Schema.TaggedError<InviteWorkflowError>()(
  "InviteWorkflowError",
  { message: Schema.String },
) {}

// --- Workflow Definition ---

export const InviteWorkflow = Workflow.make({
  name: "InviteWorkflow",
  payload: {
    inviteId: Schema.String,
    email: Schema.String,
    groups: Schema.Array(Schema.Number),
    groupNames: Schema.Array(Schema.String),
    invitedBy: Schema.String,
    token: Schema.String,
  },
  error: InviteWorkflowError,
  idempotencyKey: ({ inviteId }) => inviteId,
})

// --- Workflow Implementation ---

export const InviteWorkflowLayer = InviteWorkflow.toLayer(
  (_payload, _executionId) =>
    Effect.gen(function* () {
      const payload = _payload
      const inviteRepo = yield* InviteRepo
      const vault = yield* VaultPki
      const github = yield* GitHubClient
      const email = yield* EmailService

      // Guard: verify invite not revoked
      const invite = yield* inviteRepo.findById(payload.inviteId).pipe(
        Effect.mapError(
          (e) => new InviteWorkflowError({ message: String(e) }),
        ),
      )
      if (!invite || invite.usedBy === "__revoked__") return

      // Read current step_state for cross-retry idempotency
      const state = JSON.parse(invite.stepState || "{}")

      // Activity 1: Issue cert + P12 (stored in Vault)
      if (!state.certIssued) {
        yield* Activity.make({
          name: "IssueCert",
          error: InviteWorkflowError,
          execute: vault
            .issueCertAndP12(payload.email, payload.inviteId)
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                (e) => new InviteWorkflowError({ message: String(e) }),
              ),
            ),
        }).pipe(Activity.retry({ times: 2 }))

        yield* inviteRepo
          .updateStepState(payload.inviteId, { certIssued: true })
          .pipe(
            Effect.mapError(
              (e) => new InviteWorkflowError({ message: String(e) }),
            ),
          )
      }

      // Activity 2: Create GitHub PR (non-critical)
      if (!state.prCreated) {
        const username = payload.email
          .split("@")[0]
          .replace(/[^a-z0-9_-]/gi, "")
        yield* Activity.make({
          name: "CreatePR",
          error: InviteWorkflowError,
          execute: github
            .createCertPR(payload.inviteId, payload.email, username)
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                (e) => new InviteWorkflowError({ message: String(e) }),
              ),
            ),
        }).pipe(
          Effect.tap(() =>
            inviteRepo
              .updateStepState(payload.inviteId, { prCreated: true })
              .pipe(Effect.orDie),
          ),
          Effect.catchAll((e) =>
            Effect.logWarning("GitHub PR creation failed (non-critical)", e),
          ),
        )
      }

      // Activity 3: Send email with P12 attachment
      if (!state.emailSent) {
        // Fetch P12 from Vault (idempotent — issueCertAndP12 returns stored cert)
        const { p12Buffer } = yield* vault
          .issueCertAndP12(payload.email, payload.inviteId)
          .pipe(
            Effect.mapError(
              (e) => new InviteWorkflowError({ message: String(e) }),
            ),
          )

        yield* Activity.make({
          name: "SendEmail",
          error: InviteWorkflowError,
          execute: email
            .sendInviteEmail(
              payload.email,
              payload.token,
              payload.invitedBy,
              p12Buffer,
            )
            .pipe(
              Effect.mapError(
                (e) => new InviteWorkflowError({ message: String(e) }),
              ),
            ),
        }).pipe(Activity.retry({ times: 2 }))

        yield* inviteRepo
          .updateStepState(payload.inviteId, { emailSent: true })
          .pipe(
            Effect.mapError(
              (e) => new InviteWorkflowError({ message: String(e) }),
            ),
          )
      }
    }),
)

// --- Queue Invite (called by UI action) ---

export const queueInvite = (input: InviteInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const eventBroker = yield* EventBroker

    // Create invite record
    const invite = yield* inviteRepo.create(input)

    // Emit CloudEvent to Knative Broker
    yield* eventBroker
      .emit("duro.invite.requested", "duro/web", invite.id, {
        inviteId: invite.id,
        email: input.email,
        groups: input.groups,
        groupNames: input.groupNames,
        invitedBy: input.invitedBy,
        token: invite.token,
      })
      .pipe(
        Effect.tapError(() =>
          inviteRepo.deleteById(invite.id).pipe(Effect.ignore),
        ),
      )

    return {
      success: true as const,
      message: `Invite queued for ${input.email}`,
    }
  }).pipe(Effect.withSpan("queueInvite", { attributes: { email: input.email } }))

// --- Accept Invite (unchanged) ---

export const acceptInvite = (token: string, input: AcceptInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const lldap = yield* LldapClient

    // Atomic consume — marks invite as used
    const invite = yield* inviteRepo.consumeByToken(token)

    const groups: number[] = JSON.parse(invite.groups)

    // Create user with compensating rollback on failure
    yield* lldap.createUser({
      id: input.username,
      email: invite.email,
      displayName: input.username,
      firstName: input.username,
      lastName: "",
    })

    // Set password + add to groups, rollback user on failure
    yield* Effect.gen(function* () {
      yield* lldap.setUserPassword(input.username, input.password)
      for (const gid of groups) {
        yield* lldap.addUserToGroup(input.username, gid)
      }
    }).pipe(
      Effect.tapError(() =>
        lldap
          .deleteUser(input.username)
          .pipe(
            Effect.tap(() =>
              Effect.logWarning(
                `Rolled back user ${input.username} after configuration failure`,
              ),
            ),
            Effect.ignore,
          ),
      ),
    )

    yield* inviteRepo.markUsedBy(invite.id, input.username)

    return { success: true as const }
  }).pipe(Effect.withSpan("acceptInvite", { attributes: { username: input.username } }))
