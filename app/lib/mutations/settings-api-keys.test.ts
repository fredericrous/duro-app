// @vitest-environment node
import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { handleSettingsApiKeysMutation, parseSettingsApiKeysMutation } from "./settings-api-keys.server"
import { type SettingsApiKeysResult } from "./settings-api-keys"
import { ApiKeyRepo, type CreateApiKeyInput } from "~/lib/governance/ApiKeyRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import type { Principal, ApiKey } from "~/lib/governance/types"
import type { AuthInfo } from "~/lib/auth.server"

// ---------------------------------------------------------------------------
// Mock layers
// ---------------------------------------------------------------------------

interface MockState {
  principal: Principal | null
  keys: ApiKey[]
  createCalls: CreateApiKeyInput[]
  revokeCalls: string[]
  auditEvents: Array<{ eventType: string; targetId?: string; metadata?: Record<string, unknown> }>
}

const makeState = (overrides: Partial<MockState> = {}): MockState => ({
  principal: {
    id: "p-fred",
    principalType: "user",
    externalId: "fred",
    displayName: "Fred",
    email: "fred@example.com",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  keys: [],
  createCalls: [],
  revokeCalls: [],
  auditEvents: [],
  ...overrides,
})

const mockLayer = (state: MockState) =>
  Layer.mergeAll(
    Layer.succeed(PrincipalRepo, {
      findByExternalId: (id: string) =>
        Effect.succeed(state.principal && state.principal.externalId === id ? state.principal : null),
    } as any),
    Layer.succeed(ApiKeyRepo, {
      create: (input: CreateApiKeyInput) => {
        state.createCalls.push(input)
        const id = `k-${state.createCalls.length}`
        return Effect.succeed({ id, rawKey: `duro_${"a".repeat(64)}`, keyPreview: "duro_aaaa…aaaa" })
      },
      listForPrincipal: (_principalId: string) => Effect.succeed(state.keys),
      revoke: (id: string) => {
        state.revokeCalls.push(id)
        return Effect.void
      },
    } as any),
    Layer.succeed(AuditService, {
      emit: (event: { eventType: string; targetId?: string; metadata?: Record<string, unknown> }) => {
        state.auditEvents.push(event)
        return Effect.void
      },
    } as any),
  )

const fred: AuthInfo = { sub: "fred", user: "fred", email: "fred@example.com", groups: [] }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("settings-api-keys", () => {
  describe("parseSettingsApiKeysMutation", () => {
    const auth = fred

    const make = (entries: [string, string][]) => {
      const fd = new FormData()
      for (const [k, v] of entries) fd.append(k, v)
      return fd
    }

    it("rejects an empty name", () => {
      const fd = make([
        ["intent", "createApiKey"],
        ["expiresInDays", "90"],
        ["scopes", "invites:create"],
      ])
      expect(parseSettingsApiKeysMutation(fd, auth)).toEqual({ error: "Name is required" })
    })

    it("rejects an invalid expiry", () => {
      const fd = make([
        ["intent", "createApiKey"],
        ["name", "test"],
        ["expiresInDays", "7"],
        ["scopes", "invites:create"],
      ])
      const result = parseSettingsApiKeysMutation(fd, auth)
      expect("error" in result).toBe(true)
    })

    it("rejects when no scopes selected (and wildcard not opted in)", () => {
      const fd = make([
        ["intent", "createApiKey"],
        ["name", "test"],
        ["expiresInDays", "90"],
      ])
      expect(parseSettingsApiKeysMutation(fd, auth)).toEqual({ error: "Select at least one scope" })
    })

    it("rejects unknown scopes", () => {
      const fd = make([
        ["intent", "createApiKey"],
        ["name", "test"],
        ["expiresInDays", "30"],
        ["scopes", "not:real"],
      ])
      const result = parseSettingsApiKeysMutation(fd, auth)
      expect("error" in result).toBe(true)
    })

    it("strips wildcard from concrete scopes when allowWildcard is true", () => {
      const fd = make([
        ["intent", "createApiKey"],
        ["name", "test"],
        ["expiresInDays", "365"],
        ["scopes", "invites:create"],
        ["allowWildcard", "true"],
      ])
      const result = parseSettingsApiKeysMutation(fd, auth)
      expect(result).toMatchObject({
        intent: "createApiKey",
        scopes: ["*"],
        allowWildcard: true,
      })
    })

    it("parses a normal createApiKey form", () => {
      const fd = make([
        ["intent", "createApiKey"],
        ["name", "  claude-mcp  "],
        ["expiresInDays", "90"],
        ["scopes", "invites:create"],
        ["scopes", "grants:read"],
      ])
      expect(parseSettingsApiKeysMutation(fd, auth)).toMatchObject({
        intent: "createApiKey",
        name: "claude-mcp",
        expiresInDays: 90,
        scopes: ["invites:create", "grants:read"],
        allowWildcard: false,
      })
    })

    it("parses a revoke form", () => {
      const fd = make([
        ["intent", "revokeApiKey"],
        ["keyId", "k-1"],
      ])
      expect(parseSettingsApiKeysMutation(fd, auth)).toMatchObject({ intent: "revokeApiKey", keyId: "k-1" })
    })
  })

  describe("handleSettingsApiKeysMutation (createApiKey)", () => {
    it("returns the raw key + preview and audits the creation", async () => {
      const state = makeState()
      const result = await Effect.runPromise(
        handleSettingsApiKeysMutation({
          intent: "createApiKey",
          auth: fred,
          name: "claude-mcp",
          scopes: ["invites:create"],
          expiresInDays: 90,
          allowWildcard: false,
        }).pipe(Effect.provide(mockLayer(state))),
      )
      expect(result).toMatchObject({
        apiKeyCreated: true,
        rawKey: expect.stringMatching(/^duro_/),
        keyPreview: "duro_aaaa…aaaa",
      })
      expect(state.createCalls).toHaveLength(1)
      expect(state.createCalls[0]).toMatchObject({
        principalId: "p-fred",
        name: "claude-mcp",
        scopes: ["invites:create"],
        expiresInDays: 90,
      })
      expect(state.auditEvents).toHaveLength(1)
      expect(state.auditEvents[0]).toMatchObject({
        eventType: "api_key.created",
        targetId: "k-1",
      })
    })

    it("fails gracefully when the auth sub has no principal", async () => {
      const state = makeState({ principal: null })
      const result = (await Effect.runPromise(
        handleSettingsApiKeysMutation({
          intent: "createApiKey",
          auth: fred,
          name: "x",
          scopes: ["invites:create"],
          expiresInDays: 30,
          allowWildcard: false,
        }).pipe(Effect.provide(mockLayer(state))),
      )) as SettingsApiKeysResult
      expect("apiKeyError" in result).toBe(true)
      if ("apiKeyError" in result) expect(result.apiKeyError).toMatch(/no governance principal/i)
    })
  })

  describe("handleSettingsApiKeysMutation (revokeApiKey)", () => {
    const seededKey: ApiKey = {
      id: "k-1",
      principalId: "p-fred",
      keyHash: "h",
      keyPreview: "duro_aaaa…aaaa",
      name: "claude-mcp",
      scopes: ["invites:create"],
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    }

    it("revokes a key the caller owns", async () => {
      const state = makeState({ keys: [seededKey] })
      const result = await Effect.runPromise(
        handleSettingsApiKeysMutation({
          intent: "revokeApiKey",
          auth: fred,
          keyId: "k-1",
        }).pipe(Effect.provide(mockLayer(state))),
      )
      expect(result).toMatchObject({ apiKeyRevoked: true, keyId: "k-1" })
      expect(state.revokeCalls).toEqual(["k-1"])
      expect(state.auditEvents[0]).toMatchObject({ eventType: "api_key.revoked", targetId: "k-1" })
    })

    it("refuses to revoke a key the caller does not own", async () => {
      const state = makeState({ keys: [seededKey] })
      const result = (await Effect.runPromise(
        handleSettingsApiKeysMutation({
          intent: "revokeApiKey",
          auth: fred,
          keyId: "k-other",
        }).pipe(Effect.provide(mockLayer(state))),
      )) as SettingsApiKeysResult
      expect(result).toEqual({ apiKeyError: "Key not found" })
      expect(state.revokeCalls).toEqual([])
      expect(state.auditEvents).toHaveLength(0)
    })

    it("is idempotent on an already-revoked key", async () => {
      const state = makeState({
        keys: [{ ...seededKey, revokedAt: new Date().toISOString() }],
      })
      const result = await Effect.runPromise(
        handleSettingsApiKeysMutation({
          intent: "revokeApiKey",
          auth: fred,
          keyId: "k-1",
        }).pipe(Effect.provide(mockLayer(state))),
      )
      expect(result).toMatchObject({ apiKeyRevoked: true, keyId: "k-1" })
      // Idempotent path skips revoke + audit so the caller can collapse the
      // UI row without a confusing error.
      expect(state.revokeCalls).toEqual([])
      expect(state.auditEvents).toHaveLength(0)
    })
  })
})
