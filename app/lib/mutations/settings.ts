import { Effect } from "effect"
import { errorMessage } from "~/lib/error-message"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { resendCert } from "~/lib/workflows/invite.server"
import { supportedLngs } from "~/lib/i18n"
import { localeCookieHeader } from "~/lib/i18n.server"
import { AUTO, TIMEZONE_OPTIONS, TIME_FORMAT_OPTIONS, selectToPref } from "~/lib/datetime"
import type { AuthInfo } from "~/lib/auth.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsMutation =
  | { intent: "issueCert" | "renewCert"; label?: string | null; auth: AuthInfo }
  | { intent: "consumePassword"; auth: AuthInfo }
  | { intent: "revokeCert"; serialNumber: string; auth: AuthInfo }
  | { intent: "renameCert"; serialNumber: string; label: string | null; auth: AuthInfo }
  | { intent: "saveLocale"; locale: string; auth: AuthInfo }
  | { intent: "saveDisplayPrefs"; timezone: string | null; timeFormat: string | null; auth: AuthInfo }

export type SettingsResult =
  | { certSent: true; p12Password: string | null }
  | { certError: string }
  | { rateLimited: true; nextAvailable: string }
  | { consumed: true }
  | { certRevoked: true }
  | { certRenamed: true }
  | { displayPrefsSaved: true }
  | { error: string }

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleIssueCert(auth: AuthInfo, label?: string | null) {
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

    const result = yield* resendCert(auth.email, auth.user!, label)

    const cert = yield* CertManager
    const p12Password = yield* cert.getP12Password(result.renewalId).pipe(Effect.catchAll(() => Effect.succeed(null)))

    yield* prefs.setCertRenewal(auth.user!, result.renewalId)

    return { certSent: true as const, p12Password }
  }).pipe(
    Effect.catchAll((e) => {
      const message = errorMessage(e, "Failed to send certificate")
      return Effect.succeed({ certError: message } as SettingsResult)
    }),
  )
}

function handleConsumePassword(auth: AuthInfo) {
  return Effect.gen(function* () {
    const prefs = yield* PreferencesRepo
    const cert = yield* CertManager
    const { renewalId } = yield* prefs.getLastCertRenewal(auth.user!)
    if (renewalId) {
      yield* cert
        .deleteP12Secret(renewalId)
        .pipe(
          Effect.catchAll((e) => Effect.logWarning("consumePassword: failed to delete secret", { error: String(e) })),
        )
      yield* prefs.clearCertRenewalId(auth.user!)
    }
    return { consumed: true as const } as SettingsResult
  })
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
    case "renewCert":
      return handleIssueCert(mutation.auth, mutation.label)
    case "consumePassword":
      return handleConsumePassword(mutation.auth)
    case "revokeCert":
      return handleRevokeCert(mutation.serialNumber, mutation.auth)
    case "renameCert":
      return handleRenameCert(mutation.serialNumber, mutation.label, mutation.auth)
    case "saveLocale":
      return handleSaveLocale(mutation.locale, mutation.auth)
    case "saveDisplayPrefs":
      return handleSaveDisplayPrefs(mutation.timezone, mutation.timeFormat, mutation.auth)
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

  if (intent === "issueCert" || intent === "renewCert") {
    return { intent, label: parseLabel(formData.get("label")), auth }
  }
  if (intent === "consumePassword") {
    return { intent, auth }
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
