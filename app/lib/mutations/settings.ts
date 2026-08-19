import { Effect } from "effect"
import { errorMessage } from "~/lib/error-message"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { hashToken } from "~/lib/crypto.server"
import { config } from "~/lib/config.server"
import { resendCert } from "~/lib/workflows/invite.server"
import { supportedLngs } from "~/lib/i18n"
import { localeCookieHeader } from "~/lib/i18n.server"
import { isThemePreference, themeCookieHeader } from "~/lib/theme.server"
import { AUTO, TIMEZONE_OPTIONS, TIME_FORMAT_OPTIONS, selectToPref } from "~/lib/datetime"
import type { AuthInfo } from "~/lib/auth.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsMutation =
  | { intent: "issueCert"; delivery: "email" | "link"; auth: AuthInfo }
  | { intent: "emailRevealLink"; revealToken: string; auth: AuthInfo }
  | { intent: "renewCert"; serialNumber: string; auth: AuthInfo }
  | { intent: "revokeCert"; serialNumber: string; auth: AuthInfo }
  | { intent: "renameCert"; serialNumber: string; label: string | null; auth: AuthInfo }
  | { intent: "saveLocale"; locale: string; auth: AuthInfo }
  | { intent: "saveDisplayPrefs"; timezone: string | null; timeFormat: string | null; auth: AuthInfo }
  | { intent: "saveTheme"; theme: string; auth: AuthInfo }

export type SettingsResult =
  | { certSent: true }
  | { certLinkReady: true; revealToken: string; expiresAt: string; claimUrl: string }
  | { certError: string }
  | { rateLimited: true; nextAvailable: string }
  | { certRevoked: true }
  | { certRenamed: true }
  | { displayPrefsSaved: true }
  | { error: string }

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleIssueCert(auth: AuthInfo, delivery: "email" | "link") {
  return Effect.gen(function* () {
    if (!auth.email) {
      return { certError: "No email associated with your account." } as SettingsResult
    }

    const prefs = yield* PreferencesRepo
    const { lastCertRenewal } = { lastCertRenewal: yield* prefs.getLastCertRenewal(auth.user!) }

    if (lastCertRenewal.at) {
      const elapsed = Date.now() - lastCertRenewal.at.getTime()
      const twentyFourHours = 24 * 60 * 60 * 1000
      if (elapsed < twentyFourHours) {
        const nextAvailable = new Date(lastCertRenewal.at.getTime() + twentyFourHours).toISOString()
        return { rateLimited: true as const, nextAvailable }
      }
    }

    // No label here: the device names itself on the claim page (/cert/:token),
    // so the QR and email flows stay identical after this point.
    const result = yield* resendCert(auth.email, auth.user!, { delivery })

    yield* prefs.setCertRenewal(auth.user!, result.renewalId)

    if (result.reveal) {
      return {
        certLinkReady: true as const,
        revealToken: result.reveal.token,
        expiresAt: result.reveal.expiresAt,
        // Built server-side from the same base the renewal email uses: the
        // claim link must ride the public (join) edge — the page origin is
        // the mTLS-gated home host, which a cert-less new device cannot even
        // TLS-handshake with.
        claimUrl: `${config.inviteBaseUrl}/cert/${result.reveal.token}`,
      }
    }
    return { certSent: true as const }
  }).pipe(
    Effect.catchAll((e) => {
      const message = errorMessage(e, "Failed to send certificate")
      return Effect.succeed({ certError: message } as SettingsResult)
    }),
  )
}

/**
 * Email an ALREADY-ISSUED claim link (the QR dialog's "email me this link
 * instead"). Same token, same TTL — no second certificate, no budget spend.
 * Ownership-checked: the reveal row must belong to the caller and be alive.
 */
function handleEmailRevealLink(revealToken: string, auth: AuthInfo) {
  return Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const emailService = yield* EmailService
    const prefs = yield* PreferencesRepo
    const row = yield* revealRepo.findByTokenHash(hashToken(revealToken))
    if (!row || row.username !== auth.user || new Date(row.expiresAt) < new Date()) {
      return { certError: "Link not found" } as SettingsResult
    }
    const locale = yield* prefs.getLocale(auth.user!)
    yield* emailService.sendCertRenewalEmail(row.email, locale, revealToken)
    return { certSent: true as const } as SettingsResult
  }).pipe(
    Effect.catchAll((e) => Effect.succeed({ certError: errorMessage(e, "Failed to send the link") } as SettingsResult)),
  )
}

/** One renewal per device per day. */
const RENEW_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Renew one device's certificate.
 *
 * Unlike issueCert this does not spend the per-user 24h budget: that limit
 * exists to cap unbounded issuance of NEW devices, and applying it here would
 * mean a user with several devices could only rescue one expiring cert per day.
 * A renewal is rate-limited per device instead, bounded from both ends — the
 * cert being replaced must have settled for 24h, AND must not already have a
 * replacement younger than that. The first condition is what actually bounds a
 * renewal chain: each renewal produces a fresh cert with no successor, so a
 * successor-only check would let the chain be extended indefinitely.
 *
 * The old cert is not touched here. It is revoked when the new cert's reveal
 * link is opened (see consumeReveal), so a renewal the user never completes
 * cannot lock them out.
 */
function handleRenewCert(serialNumber: string, auth: AuthInfo) {
  return Effect.gen(function* () {
    if (!auth.email) {
      return { certError: "No email associated with your account." } as SettingsResult
    }

    const certRepo = yield* CertificateRepo
    const existing = yield* certRepo.findBySerial(serialNumber)
    // One answer for missing, not-yours, and already-revoked: never confirm the
    // existence of someone else's serial.
    if (!existing || existing.username !== auth.user || existing.revokedAt) {
      return { certError: "Certificate not found" } as SettingsResult
    }

    const successor = yield* certRepo.findLatestRenewalOf(serialNumber)
    const newestIssuedAt = Math.max(
      new Date(existing.issuedAt).getTime(),
      successor ? new Date(successor.issuedAt).getTime() : 0,
    )
    if (Date.now() - newestIssuedAt < RENEW_COOLDOWN_MS) {
      return {
        rateLimited: true as const,
        nextAvailable: new Date(newestIssuedAt + RENEW_COOLDOWN_MS).toISOString(),
      }
    }

    // The device name follows the certificate, so the row keeps its identity in
    // the list across a renewal rather than reappearing as "Unnamed device".
    yield* resendCert(auth.email, auth.user!, { label: existing.label, renewedFromSerial: serialNumber })

    return { certSent: true as const }
  }).pipe(
    Effect.catchAll((e) => {
      const message = errorMessage(e, "Failed to send certificate")
      return Effect.succeed({ certError: message } as SettingsResult)
    }),
  )
}

function handleRevokeCert(serialNumber: string, auth: AuthInfo) {
  return Effect.gen(function* () {
    const cert = yield* CertManager
    const certRepo = yield* CertificateRepo
    const affected = yield* certRepo.markRevokePending(serialNumber, auth.user!)
    if (affected === 0) {
      return yield* Effect.fail(new Error("Certificate not found"))
    }
    yield* cert.revokeCert(serialNumber).pipe(
      Effect.tap(() => certRepo.markRevokeCompleted(serialNumber)),
      Effect.tapError((e) =>
        certRepo.markRevokeFailed(serialNumber, String(e)).pipe(Effect.catchAll(() => Effect.void)),
      ),
    )
    return { certRevoked: true as const } as SettingsResult
  }).pipe(
    Effect.catchAll((e) => {
      const message = errorMessage(e, "Failed to revoke certificate")
      return Effect.succeed({ certError: message } as SettingsResult)
    }),
  )
}

function handleRenameCert(serialNumber: string, label: string | null, auth: AuthInfo) {
  return Effect.gen(function* () {
    const certRepo = yield* CertificateRepo
    const affected = yield* certRepo.setLabel(serialNumber, auth.user!, label)
    if (affected === 0) {
      return { certError: "Certificate not found" } as SettingsResult
    }
    return { certRenamed: true as const } as SettingsResult
  }).pipe(
    Effect.catchAll((e) =>
      Effect.succeed({ certError: e instanceof Error ? e.message : "Failed to rename device" } as SettingsResult),
    ),
  )
}

function handleSaveDisplayPrefs(timezone: string | null, timeFormat: string | null, auth: AuthInfo) {
  return Effect.gen(function* () {
    const prefs = yield* PreferencesRepo
    yield* prefs.setDisplayPrefs(auth.user!, { timezone, timeFormat })
    return { displayPrefsSaved: true as const } as SettingsResult
  }).pipe(
    Effect.catchAll((e) =>
      Effect.succeed({ error: errorMessage(e, "Failed to save display preferences") } as SettingsResult),
    ),
  )
}

function handleSaveTheme(theme: string, auth: AuthInfo) {
  return Effect.gen(function* () {
    if (!isThemePreference(theme)) {
      return { error: "Invalid theme" } as SettingsResult
    }
    const prefs = yield* PreferencesRepo
    yield* prefs.setTheme(auth.user!, theme)
    // Redirect marker (like saveLocale): the route sets the theme cookie so the
    // next render — and every future SSR paint — is already in the new theme.
    return { _redirect: "/settings", _cookie: themeCookieHeader(theme) } as unknown as SettingsResult
  })
}

function handleSaveLocale(locale: string, auth: AuthInfo) {
  return Effect.gen(function* () {
    if (!(supportedLngs as readonly string[]).includes(locale)) {
      return { error: "Invalid language" } as SettingsResult
    }
    const prefs = yield* PreferencesRepo
    yield* prefs.setLocale(auth.user!, locale)
    // Return a redirect marker — the route handler converts this to an actual redirect
    return { _redirect: "/settings", _cookie: localeCookieHeader(locale) } as any
  })
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleSettingsMutation(mutation: SettingsMutation) {
  switch (mutation.intent) {
    case "issueCert":
      return handleIssueCert(mutation.auth, mutation.delivery)
    case "emailRevealLink":
      return handleEmailRevealLink(mutation.revealToken, mutation.auth)
    case "renewCert":
      return handleRenewCert(mutation.serialNumber, mutation.auth)
    case "revokeCert":
      return handleRevokeCert(mutation.serialNumber, mutation.auth)
    case "renameCert":
      return handleRenameCert(mutation.serialNumber, mutation.label, mutation.auth)
    case "saveLocale":
      return handleSaveLocale(mutation.locale, mutation.auth)
    case "saveDisplayPrefs":
      return handleSaveDisplayPrefs(mutation.timezone, mutation.timeFormat, mutation.auth)
    case "saveTheme":
      return handleSaveTheme(mutation.theme, mutation.auth)
  }
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

/** Trim, cap at 64 chars, and collapse empty to null. */
function parseLabel(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim().slice(0, 64)
  return trimmed.length > 0 ? trimmed : null
}

export function parseSettingsMutation(formData: FormData, auth: AuthInfo): SettingsMutation | { error: string } {
  const intent = formData.get("intent") as string | null

  if (intent === "issueCert") {
    const delivery = formData.get("delivery") === "link" ? ("link" as const) : ("email" as const)
    return { intent, delivery, auth }
  }
  if (intent === "emailRevealLink") {
    const revealToken = formData.get("revealToken") as string
    if (!revealToken) return { error: "Missing reveal token" }
    return { intent, revealToken, auth }
  }
  if (intent === "renewCert") {
    // No label from the form — a renewal inherits the device name of the cert
    // it replaces, which the handler reads server-side.
    const serialNumber = formData.get("serialNumber") as string
    if (!serialNumber) return { error: "Missing serial number" }
    return { intent, serialNumber, auth }
  }
  if (intent === "revokeCert") {
    const serialNumber = formData.get("serialNumber") as string
    if (!serialNumber) return { error: "Missing serial number" }
    return { intent, serialNumber, auth }
  }
  if (intent === "renameCert") {
    const serialNumber = formData.get("serialNumber") as string
    if (!serialNumber) return { error: "Missing serial number" }
    return { intent, serialNumber, label: parseLabel(formData.get("label")), auth }
  }
  if (intent === "saveTheme") {
    const theme = formData.get("theme") as string
    if (!isThemePreference(theme)) return { error: "Invalid theme" }
    return { intent, theme, auth }
  }
  if (intent === "saveDisplayPrefs") {
    const tzRaw = (formData.get("timezone") as string) || AUTO
    const tfRaw = (formData.get("timeFormat") as string) || AUTO
    if (!TIMEZONE_OPTIONS.some((o) => o.value === tzRaw) || !TIME_FORMAT_OPTIONS.some((o) => o.value === tfRaw)) {
      return { error: "Invalid display preferences" }
    }
    return { intent, timezone: selectToPref(tzRaw), timeFormat: selectToPref(tfRaw), auth }
  }

  // Default: saveLocale
  const locale = formData.get("locale") as string
  if (!locale) return { error: "Missing locale" }
  return { intent: "saveLocale", locale, auth }
}
