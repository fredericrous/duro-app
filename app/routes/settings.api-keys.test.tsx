import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/mutations/settings-api-keys.server", () => ({
  parseSettingsApiKeysMutation: vi.fn(),
  handleSettingsApiKeysMutation: vi.fn(),
}))

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { parseSettingsApiKeysMutation, handleSettingsApiKeysMutation } from "~/lib/mutations/settings-api-keys.server"
import { action, loader } from "./settings.api-keys"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsApiKeysMutation)
const mockHandle = vi.mocked(handleSettingsApiKeysMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@x", sub: "s" } as never)
})

describe("/settings/api-keys loader", () => {
  it("returns the principal's API keys", async () => {
    mockRunEffect.mockResolvedValue([{ id: "k1" }] as never)
    const result = await callLoader(loader)
    const data = expectData<{ apiKeys: unknown[] }>(result)
    expect(data.apiKeys).toEqual([{ id: "k1" }])
  })
})

describe("/settings/api-keys action", () => {
  it("routes createApiKey through the mutation and returns its result", async () => {
    mockParse.mockReturnValue({ intent: "createApiKey", auth: {} } as never)
    mockHandle.mockReturnValue("api-keys-effect" as never)
    mockRunEffect.mockResolvedValue({ apiKeyCreated: true, id: "k1", rawKey: "raw" } as never)

    const result = await callAction(action, { formData: { intent: "createApiKey", name: "ci", expiresInDays: "30" } })
    const data = expectData<{ apiKeyCreated?: boolean; id?: string }>(result)
    expect(data).toEqual({ apiKeyCreated: true, id: "k1", rawKey: "raw" })
    expect(mockRunEffect).toHaveBeenCalledWith("api-keys-effect")
  })

  it("short-circuits with apiKeyError when the parser rejects", async () => {
    mockParse.mockReturnValue({ error: "Name is required" } as never)
    const result = await callAction(action, { formData: { intent: "createApiKey", name: "" } })
    const data = expectData<{ apiKeyError?: string }>(result)
    expect(data).toEqual({ apiKeyError: "Name is required" })
    expect(mockHandle).not.toHaveBeenCalled()
  })
})
