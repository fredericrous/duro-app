import { Effect } from "effect"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { GitHubClient } from "~/lib/services/GitHubClient.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"

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

// --- Queue Invite (called by UI action) ---

export const queueInvite = (input: InviteInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const vault = yield* VaultPki
    const github = yield* GitHubClient

    const invite = yield* inviteRepo.create(input)

    // Step 1: Issue cert (seconds)
    yield* vault.issueCertAndP12(input.email, invite.id)
    yield* inviteRepo.markCertIssued(invite.id)

    // Step 2: Create PR (seconds, non-critical)
    const username = input.email.split("@")[0].replace(/[^a-z0-9_-]/gi, "")
    yield* github.createCertPR(invite.id, input.email, username).pipe(
      Effect.tap(({ prNumber }) =>
        inviteRepo.markPRCreated(invite.id, prNumber),
      ),
      Effect.catchAll((e) =>
        Effect.sync(() => console.warn("[invite] PR creation failed:", e)),
      ),
    )

    // Email sent by reconciler after PR merge
    return { success: true as const, message: `Invite queued for ${input.email}` }
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
