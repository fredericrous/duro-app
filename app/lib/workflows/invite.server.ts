import { Effect } from "effect"
import * as crypto from "node:crypto"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { GitHubClient } from "~/lib/services/GitHubClient.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { EmailService } from "~/lib/services/EmailService.server"

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
      Effect.tap(({ prNumber, certUsername }) =>
        Effect.all([
          inviteRepo.markPRCreated(invite.id, prNumber),
          inviteRepo.setCertUsername(invite.id, certUsername),
        ]),
      ),
      Effect.catchAll((e) =>
        Effect.logWarning("PR creation failed").pipe(Effect.annotateLogs("error", String(e))),
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
    const vault = yield* VaultPki

    // Atomic consume — marks invite as used
    const invite = yield* inviteRepo.consumeByToken(token)

    const groups = yield* Effect.try({
      try: () => JSON.parse(invite.groups) as number[],
      catch: () => new Error("Invalid groups JSON in invite"),
    })

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

    // Clean up P12 secret from Vault
    yield* vault.deleteP12Secret(invite.id)

    return { success: true as const }
  }).pipe(Effect.withSpan("acceptInvite", { attributes: { username: input.username } }))

// --- Revoke Pending Invite (full cleanup) ---

export const revokeInvite = (inviteId: string) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const vault = yield* VaultPki
    const github = yield* GitHubClient

    const invite = yield* inviteRepo.findById(inviteId)
    if (!invite) return

    // Clean up Vault P12 secret
    yield* vault.deleteP12Secret(inviteId).pipe(
      Effect.catchAll((e) => Effect.logWarning("revokeInvite: failed to delete P12 secret", { error: String(e) })),
    )

    // Clean up p12-generator-controller secret
    if (invite.certUsername) {
      yield* vault.deleteCertByUsername(invite.certUsername).pipe(
        Effect.catchAll((e) => Effect.logWarning("revokeInvite: failed to delete cert by username", { error: String(e) })),
      )
    }

    // Close PR and delete branch if PR exists and not merged
    if (invite.prNumber && !invite.prMerged) {
      yield* github.closePR(invite.prNumber).pipe(
        Effect.catchAll((e) => Effect.logWarning("revokeInvite: failed to close PR", { error: String(e) })),
      )
      yield* github.deleteBranch(inviteId).pipe(
        Effect.catchAll((e) => Effect.logWarning("revokeInvite: failed to delete branch", { error: String(e) })),
      )
    }

    // If PR was merged, create revert PR and let worker wait for merge
    if (invite.prMerged && invite.certUsername) {
      const result = yield* github.revertCertFile(invite.certUsername, invite.email).pipe(
        Effect.catchAll((e) => {
          Effect.logWarning("revokeInvite: failed to revert cert file", { error: String(e) })
          return Effect.succeed(null as { prNumber: number } | null)
        }),
      )

      if (result) {
        yield* inviteRepo.markRevoking(inviteId)
        yield* inviteRepo.markRevertPRCreated(inviteId, result.prNumber)
        return // worker will finalize to __revoked__ after revert PR merges
      }
    }

    // No revert PR needed — revoke immediately
    yield* inviteRepo.revoke(inviteId)
  }).pipe(Effect.withSpan("revokeInvite", { attributes: { inviteId } }))

// --- Revoke Existing User ---

export const revokeUser = (username: string, email: string, revokedBy: string, reason?: string) =>
  Effect.gen(function* () {
    const lldap = yield* LldapClient
    const vault = yield* VaultPki
    const github = yield* GitHubClient
    const inviteRepo = yield* InviteRepo

    // Remove from LLDAP
    yield* lldap.deleteUser(username).pipe(
      Effect.catchAll((e) => Effect.logWarning("revokeUser: failed to delete LLDAP user", { error: String(e) })),
    )

    // Derive cert username from email (matching queueInvite pattern)
    const certUsername = email.split("@")[0].replace(/[^a-z0-9_-]/gi, "").toLowerCase()

    // Clean up Vault secret
    yield* vault.deleteCertByUsername(certUsername).pipe(
      Effect.catchAll((e) => Effect.logWarning("revokeUser: failed to delete cert secret", { error: String(e) })),
    )

    // PR to remove cert-manager Certificate
    yield* github.revertCertFile(certUsername, email).pipe(
      Effect.catchAll((e) => Effect.logWarning("revokeUser: failed to revert cert file", { error: String(e) })),
    )

    // Record revocation in audit log
    yield* inviteRepo.recordRevocation(email, username, revokedBy, reason)
  }).pipe(Effect.withSpan("revokeUser", { attributes: { username, email } }))

// --- Re-send Cert for Existing User ---

export const resendCert = (email: string, username: string) =>
  Effect.gen(function* () {
    const vault = yield* VaultPki
    const emailService = yield* EmailService

    const tempId = crypto.randomUUID()

    // Issue fresh cert
    const { p12Buffer } = yield* vault.issueCertAndP12(email, tempId)

    // Send renewal email
    yield* emailService.sendCertRenewalEmail(email, p12Buffer)

    // Clean up temp secret
    yield* vault.deleteP12Secret(tempId).pipe(
      Effect.catchAll((e) => Effect.logWarning("resendCert: failed to clean up temp secret", { error: String(e) })),
    )

    return { success: true as const, message: `Certificate sent to ${email}` }
  }).pipe(Effect.withSpan("resendCert", { attributes: { email, username } }))
