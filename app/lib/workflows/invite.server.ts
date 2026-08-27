import { Effect } from "effect"
import * as crypto from "node:crypto"
import { UserManager } from "~/lib/services/UserManager.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { InviteRepo, InviteError, type Invite } from "~/lib/services/InviteRepo.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { revokeSerialForUser } from "./cert-revocation.server"
import { parseXfccCert, canonicalSerial } from "~/lib/client-cert.server"

export interface InviteInput {
  email: string
  groups: number[]
  groupNames: string[]
  invitedBy: string
  locale?: string
  /**
   * How the invite reaches the recipient. "email" sends it inline (the default).
   * "link" issues the cert and returns the token without sending anything — the
   * admin hands the link over themselves, e.g. as a QR code scanned in person.
   */
  delivery?: "email" | "link"
}

export interface AcceptInput {
  username: string
  password: string
}

// --- Queue Invite (called by UI action) ---

/**
 * Derive a cert username from an email: the local-part, lowercased, with only
 * `[a-z0-9_-]` retained. Used for Vault cert cleanup keying.
 */
const certUsernameFromEmail = (email: string): string =>
  email
    .split("@")[0]
    .replace(/[^a-z0-9_-]/gi, "")
    .toLowerCase()

export const queueInvite = (input: InviteInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const cert = yield* CertManager
    const emailSvc = yield* EmailService
    const certRepo = yield* CertificateRepo
    const users = yield* UserManager
    const prefs = yield* PreferencesRepo
    const audit = yield* AuditService

    // Fully revoke any existing failed invite for this email before re-creating.
    // Use the revokeInvite workflow (not the bare inviteRepo.revoke, which only
    // flips used_at) so the stale invite's Vault P12 + issued cert/serial are
    // cleaned up — otherwise every failed-then-reissued invite orphans them.
    const existingFailed = yield* inviteRepo.findFailed()
    const stale = existingFailed.find((i) => i.email === input.email)
    if (stale) {
      yield* revokeInvite(stale.id)
    }

    const invite = yield* inviteRepo.create(input)

    // Derive certUsername for revocation cleanup
    const certUsername = certUsernameFromEmail(input.email)
    yield* inviteRepo.setCertUsername(invite.id, certUsername)

    // Issue cert directly from Vault PKI. The P12 is kept in Vault (keyed by
    // invite.id) so the recipient can download it from the /invite page — the
    // email no longer carries it as an attachment (Gmail phishing heuristic).
    const certResult = yield* cert.issueCertAndP12(input.email, invite.id)
    yield* inviteRepo.markCertIssued(invite.id)

    yield* audit
      .emit({
        eventType: "cert.issued",
        targetType: "user_certificate",
        targetId: certResult.serialNumber,
        metadata: { email: input.email, username: certUsername, inviteId: invite.id },
      })
      .pipe(Effect.catchAll(() => Effect.void))

    // Track the certificate
    yield* certRepo
      .store({
        inviteId: invite.id,
        userId: null,
        username: certUsername,
        email: input.email,
        serialNumber: certResult.serialNumber,
        issuedAt: new Date(),
        expiresAt: certResult.notAfter,
      })
      .pipe(Effect.catchAll((e) => Effect.logWarning("queueInvite: failed to store cert record", { error: String(e) })))

    // Respect the recipient's stored language preference when one exists (e.g.
    // re-inviting a user who already chose their language) — it wins over the
    // caller-provided locale so every email honours the user's saved choice.
    // New recipients have no stored preference, so fall back to input/"en".
    const existingUser = yield* users.getUsers.pipe(
      Effect.map((us) => us.find((u) => u.email.toLowerCase() === input.email.toLowerCase())),
      Effect.orElseSucceed(() => undefined),
    )
    const storedLocale = existingUser ? yield* prefs.getStoredLocale(existingUser.id) : null
    const locale = storedLocale ?? input.locale ?? "en"

    // Send email inline, unless the admin is delivering the link out-of-band.
    if (input.delivery !== "link") {
      yield* emailSvc
        .sendInviteEmail(input.email, invite.token, input.invitedBy, locale, invite.openToken, invite.id)
        .pipe(
          Effect.tap((messageId) => inviteRepo.setMessageId(invite.id, messageId)),
          Effect.tap(() => inviteRepo.markEmailSent(invite.id)),
          Effect.catchAll((e) =>
            Effect.gen(function* () {
              yield* inviteRepo.markFailed(invite.id, e.message)
              yield* Effect.fail(e)
            }),
          ),
        )
    }

    return {
      success: true as const,
      message: input.delivery === "link" ? `Invite ready for ${input.email}` : `Invite sent to ${input.email}`,
      token: invite.token,
      inviteId: invite.id,
      expiresAt: invite.expiresAt,
    }
  }).pipe(Effect.withSpan("queueInvite", { attributes: { email: input.email } }))

// --- Accept Invite ---

/**
 * Shared tail of both accept paths: given an invite already atomically claimed
 * (used_at set, but no account yet), create the LLDAP user, set the password
 * and groups, then bind the certificate to the real user and clean up.
 *
 * Idempotent enough to survive a retry after a partial crash: if the LLDAP user
 * already exists AND its email matches this invite, we treat that as our own
 * earlier attempt and roll forward (bind + finish) instead of erroring — a hard
 * pod kill between createUser and the DB bind must converge to a usable account,
 * not dead-end. A username that already belongs to a DIFFERENT email is a real
 * collision: release the claim so the invitee can pick another name.
 */
const finishAccept = (invite: Invite, input: AcceptInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const users = yield* UserManager
    const cert = yield* CertManager
    const certRepo = yield* CertificateRepo

    const groups = yield* Effect.try({
      try: () => JSON.parse(invite.groups) as number[],
      catch: () => new Error("Invalid groups JSON in invite"),
    })

    // Create the user, or roll forward onto our own half-created one.
    yield* users
      .createUser({
        id: input.username,
        email: invite.email,
        displayName: input.username,
        firstName: input.username,
        lastName: "",
      })
      .pipe(
        Effect.catchAll((e: unknown) => {
          const msg = String((e as { message?: unknown })?.message ?? e)
          const alreadyExists =
            msg.includes("UNIQUE") ||
            msg.includes("unique") ||
            msg.includes("already exists") ||
            msg.includes("duplicate")
          if (!alreadyExists) {
            // Genuine failure — hand the invite back so the attempt can retry.
            return inviteRepo
              .releaseById(invite.id)
              .pipe(Effect.ignore, Effect.andThen(Effect.fail(new Error(`Failed to create user: ${msg}`))))
          }
          // Already exists: is it ours (same email) or someone else's name?
          return users.getUsers.pipe(
            Effect.catchAll(() => Effect.succeed([] as Array<{ id: string; email: string }>)),
            Effect.flatMap((existing) => {
              const match = existing.find((u) => u.id === input.username)
              if (match && match.email.toLowerCase() === invite.email.toLowerCase()) {
                // Our own earlier attempt — roll forward.
                return Effect.logInfo(
                  `finishAccept: recovering existing user ${input.username} for invite ${invite.id}`,
                )
              }
              // Someone else already holds this username.
              return inviteRepo
                .releaseById(invite.id)
                .pipe(
                  Effect.ignore,
                  Effect.andThen(Effect.fail(new Error(`A user with this email or username already exists`))),
                )
            }),
          )
        }),
      )

    // Set password + groups; a failure here rolls the user back and releases.
    yield* Effect.gen(function* () {
      yield* users.setUserPassword(input.username, input.password)
      for (const gid of groups) {
        // Tolerate "already a member" so a rolled-forward retry is idempotent.
        yield* users.addUserToGroup(input.username, gid).pipe(
          Effect.catchAll((e) => {
            const msg = String((e as { message?: unknown })?.message ?? e).toLowerCase()
            if (msg.includes("already") || msg.includes("member") || msg.includes("duplicate")) return Effect.void
            return Effect.fail(e)
          }),
        )
      }
    }).pipe(
      Effect.tapError(() =>
        Effect.gen(function* () {
          yield* users.deleteUser(input.username).pipe(
            Effect.tap(() => Effect.logWarning(`Rolled back user ${input.username} after configuration failure`)),
            Effect.ignore,
          )
          yield* inviteRepo.releaseById(invite.id).pipe(Effect.ignore)
        }),
      ),
    )

    yield* inviteRepo.markUsedBy(invite.id, input.username)

    yield* certRepo
      .setUserId(invite.id, input.username)
      .pipe(
        Effect.catchAll((e) => Effect.logWarning("finishAccept: failed to set userId on cert", { error: String(e) })),
      )
    const certUsername = certUsernameFromEmail(invite.email)
    yield* certRepo
      .updateUsername(certUsername, input.username)
      .pipe(
        Effect.catchAll((e) =>
          Effect.logWarning("finishAccept: failed to update username on cert", { error: String(e) }),
        ),
      )

    yield* cert.deleteP12Secret(invite.id)

    return { success: true as const }
  })

export const acceptInvite = (token: string, input: AcceptInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const invite = yield* inviteRepo.consumeByToken(token)
    return yield* finishAccept(invite, input)
  }).pipe(Effect.withSpan("acceptInvite", { attributes: { username: input.username } }))

/**
 * Accept an invite identified by its id rather than a raw token. The
 * cert-authenticated `/setup` flow has no token — it resolves the invite from
 * the presented client certificate — so it lands here.
 *
 * Handles the crash-stuck `Accepted`/`usedBy == null` state (a pod killed
 * between the up-front `used_at` claim and `markUsedBy`): there is no account,
 * so `releaseById` first (which only un-claims when `used_by` is null), then
 * claim atomically by id. A genuinely used invite (`usedBy != null`) or a
 * revoked/expired one is refused up front.
 */
export const acceptInviteById = (inviteId: string, input: AcceptInput) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const existing = yield* inviteRepo.findById(inviteId)
    if (!existing) {
      return yield* new InviteError({ message: "Invite is invalid, expired, or already used" })
    }
    const status = existing.status
    if (status._tag === "Accepted" && status.usedBy !== null) {
      return yield* new InviteError({ message: "Invite is invalid, expired, or already used" })
    }
    if (status._tag === "Revoked" || status._tag === "Revoking") {
      return yield* new InviteError({ message: "Invite is invalid, expired, or already used" })
    }
    if (new Date(existing.expiresAt) < new Date()) {
      return yield* new InviteError({ message: "Invite is invalid, expired, or already used" })
    }
    // Reset a stuck up-front claim (no-op for a genuinely pending invite), then
    // claim atomically so two concurrent /setup submits cannot both proceed.
    yield* inviteRepo.releaseById(inviteId).pipe(Effect.ignore)
    const invite = yield* inviteRepo.consumeById(inviteId)
    return yield* finishAccept(invite, input)
  }).pipe(Effect.withSpan("acceptInviteById", { attributes: { username: input.username, inviteId } }))

// --- Revoke Pending Invite (full cleanup) ---

export const revokeInvite = (inviteId: string) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const cert = yield* CertManager
    const certRepo = yield* CertificateRepo

    const invite = yield* inviteRepo.findById(inviteId)
    if (!invite) return

    // Clean up P12 secret
    yield* cert
      .deleteP12Secret(inviteId)
      .pipe(
        Effect.catchAll((e) => Effect.logWarning("revokeInvite: failed to delete P12 secret", { error: String(e) })),
      )

    // Clean up cert secret by username
    const certUsername = invite.certUsername ?? certUsernameFromEmail(invite.email)
    yield* cert
      .deleteCertByUsername(certUsername)
      .pipe(
        Effect.catchAll((e) =>
          Effect.logWarning("revokeInvite: failed to delete cert by username", { error: String(e) }),
        ),
      )

    // Revoke tracked certs for this invite's certUsername
    const serials = yield* certRepo
      .revokeAllForUser(certUsername)
      .pipe(Effect.catchAll(() => Effect.succeed([] as string[])))
    yield* Effect.forEach(serials, (serial) => revokeSerialForUser(serial, { auditUsername: certUsername }), {
      concurrency: 4,
    })

    yield* inviteRepo.revoke(inviteId)
  }).pipe(Effect.withSpan("revokeInvite", { attributes: { inviteId } }))

// --- Revoke Existing User ---

export const revokeUser = (username: string, email: string, revokedBy: string, reason?: string) =>
  Effect.gen(function* () {
    const users = yield* UserManager
    const cert = yield* CertManager
    const inviteRepo = yield* InviteRepo
    const certRepo = yield* CertificateRepo
    const audit = yield* AuditService

    // Remove from user directory
    yield* users
      .deleteUser(username)
      .pipe(Effect.catchAll((e) => Effect.logWarning("revokeUser: failed to delete user", { error: String(e) })))

    yield* audit
      .emit({
        eventType: "user.revoked",
        targetType: "user",
        targetId: username,
        metadata: { email, reason, revokedBy },
      })
      .pipe(Effect.catchAll(() => Effect.void))

    const certUsername = certUsernameFromEmail(email)

    // Clean up cert secret
    yield* cert
      .deleteCertByUsername(certUsername)
      .pipe(Effect.catchAll((e) => Effect.logWarning("revokeUser: failed to delete cert secret", { error: String(e) })))

    // Revoke all tracked certs with partial-failure handling
    const serials = yield* certRepo
      .revokeAllForUser(username)
      .pipe(Effect.catchAll(() => Effect.succeed([] as string[])))
    yield* Effect.forEach(serials, (serial) => revokeSerialForUser(serial, { auditUsername: certUsername }), {
      concurrency: 4,
    })

    // Record revocation in audit log
    yield* inviteRepo.recordRevocation(email, username, revokedBy, reason)
  }).pipe(Effect.withSpan("revokeUser", { attributes: { username, email } }))

// --- Re-send Cert for Existing User ---

/** How long an emailed cert-reveal link stays valid. */
const REVEAL_TTL_MS = 24 * 60 * 60 * 1000

export interface ResendCertOptions {
  /** Device name carried onto the new cert. */
  label?: string | null
  /**
   * Serial of the cert this issuance replaces. Recorded on both the cert row
   * and the reveal token; the old cert is revoked when the reveal is consumed,
   * never before — the user must have the replacement in hand first, or a
   * renewal would lock them out of an mTLS-gated app.
   */
  renewedFromSerial?: string | null
  /**
   * How the reveal link reaches the device. "email" (default) keeps the
   * historical flow. "link" skips the email entirely and hands the link back
   * to the caller — the /devices page renders it as a QR so the new device
   * scans its way straight to /cert/:token. Same token, same TTL, same
   * single-use semantics either way.
   */
  delivery?: "email" | "link"
}

export const resendCert = (email: string, username: string, opts: ResendCertOptions = {}) =>
  Effect.gen(function* () {
    const cert = yield* CertManager
    const emailService = yield* EmailService
    const prefs = yield* PreferencesRepo
    const certRepo = yield* CertificateRepo
    const revealRepo = yield* CertRevealRepo
    const audit = yield* AuditService

    const tempId = crypto.randomUUID()
    const locale = yield* prefs.getLocale(username)

    // Issue fresh cert. The P12 password is stored in Vault keyed by tempId and
    // is NOT deleted here — it must survive until the recipient reveals it via
    // the emailed scratch-card link, the only surface that hands it out.
    const certResult = yield* cert.issueCertAndP12(email, tempId)

    yield* audit
      .emit({
        eventType: "cert.issued",
        targetType: "user_certificate",
        targetId: certResult.serialNumber,
        metadata: { email, username, renewedFrom: opts.renewedFromSerial ?? null },
      })
      .pipe(Effect.catchAll(() => Effect.void))

    // Track the certificate
    yield* certRepo
      .store({
        inviteId: null,
        userId: username,
        username,
        email,
        label: opts.label ?? null,
        serialNumber: certResult.serialNumber,
        issuedAt: new Date(),
        expiresAt: certResult.notAfter,
        renewedFromSerial: opts.renewedFromSerial ?? null,
      })
      .pipe(Effect.catchAll((e) => Effect.logWarning("resendCert: failed to store cert record", { error: String(e) })))

    // Mint a single-use, short-lived reveal link for the renewal email. The
    // renewal email carries the P12 file but not the password — the recipient
    // scratches it open at /cert/:token (mirrors onboarding's /invite reveal).
    const reveal = yield* revealRepo.create({
      renewalId: tempId,
      email,
      username,
      expiresAt: new Date(Date.now() + REVEAL_TTL_MS),
      renewedFromSerial: opts.renewedFromSerial ?? null,
      serialNumber: certResult.serialNumber,
    })

    const expiresAt = new Date(Date.now() + REVEAL_TTL_MS).toISOString()

    if ((opts.delivery ?? "email") === "link") {
      // QR flow: the caller shows the link to the authenticated owner —
      // no email leaves the building.
      return {
        success: true as const,
        message: "Certificate ready",
        renewalId: tempId,
        reveal: { token: reveal.token, expiresAt },
      }
    }

    // Send the link-only renewal email (no P12 attachment — the cert is
    // downloaded from the reveal page, behind the same token).
    yield* emailService.sendCertRenewalEmail(email, locale, reveal.token)

    return { success: true as const, message: `Certificate sent to ${email}`, renewalId: tempId }
  }).pipe(Effect.withSpan("resendCert", { attributes: { email, username } }))

/**
 * Classify what a presented client certificate means for the invite flow, from
 * the Envoy-set `x-forwarded-client-cert` header. Shared by the `/setup` route
 * and by `requireAuth`'s pending-invite redirect so both read identity the same
 * way. Identity is the certificate only — safe because the mTLS listener
 * (optional:false + XFCC SanitizeSet) guarantees Envoy set this header from a
 * handshake it validated against the daddyshome CA.
 */
export type CertInviteResolution =
  | { kind: "no_cert" }
  | { kind: "invalid" }
  | { kind: "revoked" }
  | { kind: "expired" }
  | { kind: "too_many_attempts" }
  | { kind: "has_account" }
  | { kind: "pending"; inviteId: string; email: string }

export const resolvePendingCertInvite = (xfcc: string | null | undefined) =>
  Effect.gen(function* () {
    const parsed = parseXfccCert(xfcc)
    if (!parsed) return { kind: "no_cert" } as CertInviteResolution

    const certRepo = yield* CertificateRepo
    const inviteRepo = yield* InviteRepo
    const cert = yield* certRepo.findBySerialCanonical(canonicalSerial(parsed.serial))
    if (!cert) return { kind: "invalid" } as CertInviteResolution
    if (cert.revokedAt !== null) return { kind: "revoked" } as CertInviteResolution
    if (cert.userId !== null) return { kind: "has_account" } as CertInviteResolution
    if (!cert.inviteId) return { kind: "invalid" } as CertInviteResolution

    const invite = yield* inviteRepo.findById(cert.inviteId)
    if (!invite) return { kind: "invalid" } as CertInviteResolution
    const status = invite.status
    if (status._tag === "Accepted" && status.usedBy !== null) return { kind: "has_account" } as CertInviteResolution
    if (status._tag === "Revoked" || status._tag === "Revoking") return { kind: "revoked" } as CertInviteResolution
    if (new Date(invite.expiresAt) < new Date()) return { kind: "expired" } as CertInviteResolution
    if (invite.attempts >= 5) return { kind: "too_many_attempts" } as CertInviteResolution
    return { kind: "pending", inviteId: invite.id, email: invite.email } as CertInviteResolution
  })
