import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/mutations/settings-git-keys.server", () => ({
  parseSettingsGitKeysMutation: vi.fn(),
  handleSettingsGitKeysMutation: vi.fn(),
}))
// the loader gates on config.forgejoUrl; isOriginAllowed gates the action
vi.mock("~/lib/config.server", () => ({
  config: { forgejoUrl: "http://forgejo.test:3000", forgejoPublicUrl: "https://git.example.com" },
  isOriginAllowed: vi.fn(() => true),
}))

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { parseSettingsGitKeysMutation, handleSettingsGitKeysMutation } from "~/lib/mutations/settings-git-keys.server"
import { action, loader } from "./settings.git"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsGitKeysMutation)
const mockHandle = vi.mocked(handleSettingsGitKeysMutation)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  mockRequireAuth.mockResolvedValue({ user: "fred", email: "f@x", sub: "sub-uuid" } as never)
})

describe("/settings/git loader", () => {
  it("redirects to /settings when Forgejo is unconfigured (nav is hidden too)", async () => {
    const saved = config.forgejoUrl
    ;(config as { forgejoUrl: string }).forgejoUrl = ""
    try {
      const result = await callLoader(loader)
      const response = expectResponse(result)
      expect(response.status).toBe(302)
      expect(response.headers.get("Location")).toBe("/settings")
    } finally {
      ;(config as { forgejoUrl: string }).forgejoUrl = saved
    }
  })

  it("returns the state from the effect plus username and the public URL", async () => {
    mockRunEffect.mockResolvedValue({ status: "ready", keys: [{ id: 1 }] } as never)
    const result = await callLoader(loader)
    const data = expectData<{ status: string; keys: unknown[]; username: string; gitWebUrl: string }>(result)
    expect(data).toMatchObject({
      status: "ready",
      keys: [{ id: 1 }],
      username: "fred",
      gitWebUrl: "https://git.example.com",
    })
  })
})

describe("/settings/git action", () => {
  it("403s on a disallowed Origin before any parsing", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "addGitKey" } })
    // the action RETURNS (not throws) the Response — route-utils surfaces it as data
    const response = expectData<Response>(result)
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(403)
    expect(mockParse).not.toHaveBeenCalled()
  })

  it("routes the mutation through the handler", async () => {
    mockParse.mockReturnValue({ intent: "addGitKey", auth: {} } as never)
    mockHandle.mockReturnValue("git-keys-effect" as never)
    mockRunEffect.mockResolvedValue({ gitKeyAdded: true, id: 42 } as never)
    const result = await callAction(action, { formData: { intent: "addGitKey", title: "L", publicKey: "k" } })
    const data = expectData<{ gitKeyAdded?: boolean }>(result)
    expect(data).toMatchObject({ gitKeyAdded: true, id: 42 })
    expect(mockRunEffect).toHaveBeenCalledWith("git-keys-effect")
  })

  it("parser rejection short-circuits to a machine code without the handler", async () => {
    mockParse.mockReturnValue({ error: "Missing key" } as never)
    const result = await callAction(action, { formData: { intent: "addGitKey" } })
    const data = expectData<{ gitKeyError?: string }>(result)
    expect(data).toEqual({ gitKeyError: "unknown" })
    expect(mockHandle).not.toHaveBeenCalled()
  })
})
