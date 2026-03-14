import { describe, it, expect } from "vitest"
import { parseSettingsMutation } from "./settings"
import type { AuthInfo } from "~/lib/auth.server"

const auth: AuthInfo = { user: "testuser", email: "test@example.com", groups: ["users"] }

describe("parseSettingsMutation", () => {
  it("parses issueCert", () => {
    const fd = new FormData()
    fd.append("intent", "issueCert")
    const result = parseSettingsMutation(fd, auth)
    expect(result).toEqual({ intent: "issueCert", auth })
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
