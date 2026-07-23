// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { parseSettingsMutation, handleSettingsMutation } from "./settings"
import type { AuthInfo } from "~/lib/auth.server"
import { truncateAll, testRunEffect } from "~/test/test-runtime"

const auth: AuthInfo = { sub: "testuser-sub", user: "testuser", email: "test@example.com", groups: ["users"] }

beforeEach(async () => {
  await truncateAll()
})

describe("parseSettingsMutation", () => {
  it("parses issueCert (no label → null)", () => {
    const fd = new FormData()
    fd.append("intent", "issueCert")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "issueCert", label: null, auth })
  })

  it("parses issueCert with a device label (trimmed)", () => {
    const fd = new FormData()
    fd.append("intent", "issueCert")
    fd.append("label", "  MacBook Pro  ")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "issueCert", label: "MacBook Pro", auth })
  })

  it("parses consumePassword", () => {
    const fd = new FormData()
    fd.append("intent", "consumePassword")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "consumePassword", auth })
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
  it("consumePassword is a no-op when there's no renewal in flight", async () => {
    // Empty preferences row → renewalId is null → handler short-circuits.
    const result = await testRunEffect(
      handleSettingsMutation({ intent: "consumePassword", auth }) as Effect.Effect<unknown, unknown, never>,
    )
    expect(result).toEqual({ consumed: true })
  })

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
