// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { parseSettingsMutation, handleSettingsMutation } from "./settings"
import { CertificateRepo, type UserCertificate } from "~/lib/services/CertificateRepo.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import type { AuthInfo } from "~/lib/auth.server"
import { truncateAll, testRunEffect } from "~/test/test-runtime"

const auth: AuthInfo = { sub: "testuser-sub", user: "testuser", email: "test@example.com", groups: ["users"] }

beforeEach(async () => {
  await truncateAll()
})

describe("parseSettingsMutation", () => {
  it("parses issueCert (no delivery → email, the historical flow)", () => {
    const fd = new FormData()
    fd.append("intent", "issueCert")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "issueCert", delivery: "email", auth })
  })

  it("parses issueCert with link delivery (the QR flow)", () => {
    const fd = new FormData()
    fd.append("intent", "issueCert")
    fd.append("delivery", "link")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "issueCert", delivery: "link", auth })
  })

  it("parses emailRevealLink with its token, and rejects it without one", () => {
    const fd = new FormData()
    fd.append("intent", "emailRevealLink")
    fd.append("revealToken", "tok-abc")
    expect(parseSettingsMutation(fd, auth)).toEqual({ intent: "emailRevealLink", revealToken: "tok-abc", auth })

    const bare = new FormData()
    bare.append("intent", "emailRevealLink")
    expect(parseSettingsMutation(bare, auth)).toEqual({ error: "Missing reveal token" })
  })

  it("issueCert ignores a stray label field — naming happens at claim time", () => {
    const fd = new FormData()
    fd.append("intent", "issueCert")
    fd.append("label", "MacBook Pro")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "issueCert", delivery: "email", auth })
  })

  it("parses revokeCert with serialNumber", () => {
    const fd = new FormData()
    fd.append("intent", "revokeCert")
    fd.append("serialNumber", "abc-123")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "revokeCert", serialNumber: "abc-123", auth })
  })

  it("returns error for revokeCert without serialNumber", () => {
    const fd = new FormData()
    fd.append("intent", "revokeCert")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ error: "Missing serial number" })
  })

  it("parses renameCert with serialNumber and label", () => {
    const fd = new FormData()
    fd.append("intent", "renameCert")
    fd.append("serialNumber", "abc-123")
    fd.append("label", "Work laptop")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "renameCert", serialNumber: "abc-123", label: "Work laptop", auth })
  })

  it("renameCert with a blank label clears it (null)", () => {
    const fd = new FormData()
    fd.append("intent", "renameCert")
    fd.append("serialNumber", "abc-123")
    fd.append("label", "   ")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "renameCert", serialNumber: "abc-123", label: null, auth })
  })

  it("parses saveDisplayPrefs, mapping the AUTO sentinel to null", () => {
    const fd = new FormData()
    fd.append("intent", "saveDisplayPrefs")
    fd.append("timezone", "Europe/Paris")
    fd.append("timeFormat", "auto")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "saveDisplayPrefs", timezone: "Europe/Paris", timeFormat: null, auth })
  })

  it("rejects saveDisplayPrefs with an unknown timezone", () => {
    const fd = new FormData()
    fd.append("intent", "saveDisplayPrefs")
    fd.append("timezone", "Mars/Olympus")
    fd.append("timeFormat", "24")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ error: "Invalid display preferences" })
  })

  it("parses saveTheme with a valid theme", () => {
    const fd = new FormData()
    fd.append("intent", "saveTheme")
    fd.append("theme", "light")
    expect(parseSettingsMutation(fd, auth)).toEqual({ intent: "saveTheme", theme: "light", auth })
  })

  it("parses saveTheme with the system preference", () => {
    const fd = new FormData()
    fd.append("intent", "saveTheme")
    fd.append("theme", "system")
    expect(parseSettingsMutation(fd, auth)).toEqual({ intent: "saveTheme", theme: "system", auth })
  })

  it("rejects saveTheme with an unknown theme", () => {
    const fd = new FormData()
    fd.append("intent", "saveTheme")
    fd.append("theme", "neon")
    expect(parseSettingsMutation(fd, auth)).toEqual({ error: "Invalid theme" })
  })

  it("parses saveLocale as default", () => {
    const fd = new FormData()
    fd.append("locale", "fr")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "saveLocale", locale: "fr", auth })
  })

  it("returns error for missing locale", () => {
    const fd = new FormData()
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ error: "Missing locale" })
  })
})

// =============================================================================
// handleSettingsMutation — happy paths via real PGlite + dev-layer services
// =============================================================================

describe("handleSettingsMutation", () => {
  it("saveLocale persists the new locale to preferences and returns a redirect marker", async () => {
    const result = await testRunEffect(
      handleSettingsMutation({ intent: "saveLocale", locale: "fr", auth }) as Effect.Effect<unknown, unknown, never>,
    )
    expect(result).toMatchObject({ _redirect: "/settings" })

    // The locale row should now exist in the preferences table.
    const rows = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ locale: string | null }>`
          SELECT locale FROM user_preferences WHERE username = ${auth.user!}`
      }) as Effect.Effect<Array<{ locale: string | null }>, never, never>,
    )
    expect(rows[0]?.locale).toBe("fr")
  })

  it("saveLocale rejects an unsupported language", async () => {
    const result = await testRunEffect(
      handleSettingsMutation({ intent: "saveLocale", locale: "xx", auth }) as Effect.Effect<unknown, unknown, never>,
    )
    expect(result).toEqual({ error: "Invalid language" })
  })

  it("revokeCert returns 'Certificate not found' when the serial doesn't match a row", async () => {
    const result = await testRunEffect(
      handleSettingsMutation({ intent: "revokeCert", serialNumber: "no-such-serial", auth }) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    )
    // The handler swallows the error into a `certError` shape.
    expect(result).toMatchObject({ certError: "Certificate not found" })
  })
})

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

describe("parseSettingsMutation — renewCert", () => {
  it("parses renewCert with serialNumber", () => {
    const fd = new FormData()
    fd.append("intent", "renewCert")
    fd.append("serialNumber", "abc-123")
    expect(parseSettingsMutation(fd, auth)).toEqual({ intent: "renewCert", serialNumber: "abc-123", auth })
  })

  it("returns error for renewCert without serialNumber", () => {
    const fd = new FormData()
    fd.append("intent", "renewCert")
    expect(parseSettingsMutation(fd, auth)).toEqual({ error: "Missing serial number" })
  })

  it("ignores a label submitted with renewCert — the device name comes from the old cert", () => {
    const fd = new FormData()
    fd.append("intent", "renewCert")
    fd.append("serialNumber", "abc-123")
    fd.append("label", "attacker supplied")
    expect(parseSettingsMutation(fd, auth)).toEqual({ intent: "renewCert", serialNumber: "abc-123", auth })
  })
})

describe("handleSettingsMutation — renewCert", () => {
  const seedCert = (over: { serialNumber: string; username?: string; label?: string | null; issuedAt?: Date }) =>
    testRunEffect(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store({
          username: over.username ?? auth.user!,
          email: "test@example.com",
          label: over.label ?? null,
          serialNumber: over.serialNumber,
          issuedAt: over.issuedAt ?? new Date(Date.now() - 60 * 86_400_000),
          expiresAt: new Date(Date.now() + 5 * 86_400_000),
        })
      }) as Effect.Effect<void, never, never>,
    )

  const renew = (serialNumber: string) =>
    testRunEffect(
      handleSettingsMutation({ intent: "renewCert", serialNumber, auth }) as Effect.Effect<unknown, unknown, never>,
    )

  const certsFor = (username: string) =>
    testRunEffect(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        return yield* repo.listUnrevoked(username)
      }) as Effect.Effect<UserCertificate[], never, never>,
    )

  const lastCertRenewalAt = () =>
    testRunEffect(
      Effect.gen(function* () {
        const prefs = yield* PreferencesRepo
        return (yield* prefs.getLastCertRenewal(auth.user!)).at
      }) as Effect.Effect<Date | null, never, never>,
    )

  it("issues a replacement carrying the old device's name and lineage", async () => {
    await seedCert({ serialNumber: "SN-RENEW", label: "MacBook Pro" })

    expect(await renew("SN-RENEW")).toMatchObject({ certSent: true })

    const replacement = (await certsFor(auth.user!)).find((c) => c.renewedFromSerial === "SN-RENEW")
    expect(replacement).toBeDefined()
    expect(replacement!.label).toBe("MacBook Pro")
  })

  it("does not spend the per-user new-device budget", async () => {
    await seedCert({ serialNumber: "SN-BUDGET" })
    await renew("SN-BUDGET")
    // Rescuing an expiring device must not block adding a different one.
    expect(await lastCertRenewalAt()).toBeNull()
  })

  it("issueCert with link delivery returns the claim link instead of emailing", async () => {
    const result = await testRunEffect(
      handleSettingsMutation({ intent: "issueCert", delivery: "link", auth }) as Effect.Effect<unknown, unknown, never>,
    )
    expect(result).toMatchObject({ certLinkReady: true })
    const r = result as { revealToken: string; expiresAt: string; claimUrl: string }
    expect(r.revealToken.length).toBeGreaterThan(20)
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now())
    // The claim URL rides the public (join) edge the email uses — never the
    // mTLS-gated host the admin happens to be browsing.
    expect(r.claimUrl).toBe(`https://join.daddyshome.fr/cert/${r.revealToken}`)
    // the QR flow spends the same per-user budget as the email flow
    expect(await lastCertRenewalAt()).not.toBeNull()
  })

  it("issueCert still stamps the per-user budget", async () => {
    expect(
      await testRunEffect(
        handleSettingsMutation({ intent: "issueCert", delivery: "email", auth }) as Effect.Effect<
          unknown,
          unknown,
          never
        >,
      ),
    ).toMatchObject({ certSent: true })
    expect(await lastCertRenewalAt()).not.toBeNull()
  })

  describe("emailRevealLink — the dialog's 'email me this link' fallback", () => {
    /** Issue via link delivery and hand back the live token. */
    const issueLink = async (who: AuthInfo = auth) => {
      const result = await testRunEffect(
        handleSettingsMutation({ intent: "issueCert", delivery: "link", auth: who }) as Effect.Effect<
          unknown,
          unknown,
          never
        >,
      )
      return (result as { revealToken: string }).revealToken
    }

    it("emails the SAME token without minting a second cert or re-spending the budget", async () => {
      const token = await issueLink()
      const before = await certsFor(auth.user!)
      const result = await testRunEffect(
        handleSettingsMutation({ intent: "emailRevealLink", revealToken: token, auth }) as Effect.Effect<
          unknown,
          unknown,
          never
        >,
      )
      expect(result).toMatchObject({ certSent: true })
      // same token → same cert; nothing new was issued
      expect(await certsFor(auth.user!)).toHaveLength(before.length)
    })

    it("refuses another user's token without an existence oracle", async () => {
      const token = await issueLink()
      const mallory: AuthInfo = { sub: "m-sub", user: "mallory", email: "m@example.com", groups: ["users"] }
      const result = await testRunEffect(
        handleSettingsMutation({ intent: "emailRevealLink", revealToken: token, auth: mallory }) as Effect.Effect<
          unknown,
          unknown,
          never
        >,
      )
      // Indistinguishable from a token that never existed.
      expect(result).toMatchObject({ certError: "Link not found" })
    })

    it("refuses a token that never existed", async () => {
      const result = await testRunEffect(
        handleSettingsMutation({ intent: "emailRevealLink", revealToken: "nope", auth }) as Effect.Effect<
          unknown,
          unknown,
          never
        >,
      )
      expect(result).toMatchObject({ certError: "Link not found" })
    })
  })

  it("rate-limits a device renewed within the last 24h", async () => {
    await seedCert({ serialNumber: "SN-TWICE" })
    await renew("SN-TWICE")

    const second = await renew("SN-TWICE")
    expect(second).toMatchObject({ rateLimited: true })
  })

  it("rate-limits a certificate that is itself less than a day old", async () => {
    // This is what bounds a renewal chain: the replacement has no successor of
    // its own, so without this it could be renewed again immediately.
    await seedCert({ serialNumber: "SN-FRESH", issuedAt: new Date(Date.now() - 60 * 60 * 1000) })
    expect(await renew("SN-FRESH")).toMatchObject({ rateLimited: true })
  })

  it("refuses an unknown serial", async () => {
    expect(await renew("SN-NOPE")).toMatchObject({ certError: "Certificate not found" })
  })

  it("refuses another user's serial without issuing anything", async () => {
    await seedCert({ serialNumber: "SN-MALLORY", username: "mallory" })

    expect(await renew("SN-MALLORY")).toMatchObject({ certError: "Certificate not found" })
    // No existence oracle, and no cert minted for the caller either.
    expect(await certsFor(auth.user!)).toHaveLength(0)
    expect(await certsFor("mallory")).toHaveLength(1)
  })

  it("refuses an already-revoked serial", async () => {
    await seedCert({ serialNumber: "SN-DEAD" })
    await testRunEffect(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.markRevokeCompleted("SN-DEAD")
      }) as Effect.Effect<void, never, never>,
    )

    expect(await renew("SN-DEAD")).toMatchObject({ certError: "Certificate not found" })
  })
})
