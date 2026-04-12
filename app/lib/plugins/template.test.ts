import { describe, it, expect } from "vitest"
import { resolveTemplate, resolveTemplateObject } from "./template"
import type { GrantContext } from "./contracts"

const ctx: GrantContext = {
  grant: {
    id: "g1",
    principalId: "p1",
    roleId: "r1",
    entitlementId: null,
    resourceId: null,
    grantedBy: "admin",
    reason: "test grant",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date().toISOString(),
  },
  role: {
    id: "r1",
    applicationId: "app1",
    slug: "editor",
    displayName: "Editor",
    description: null,
    maxDurationHours: null,
    createdAt: new Date().toISOString(),
  },
  principal: {
    id: "p1",
    principalType: "user",
    externalId: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  applicationId: "app1",
  applicationSlug: "nextcloud",
  config: { viewerGroup: "nextcloud-user", editorGroup: "nextcloud-user", adminGroup: "nextcloud-admin" },
}

describe("resolveTemplate", () => {
  it("resolves ${principal.externalId}", () => {
    expect(resolveTemplate("${principal.externalId}", ctx)).toBe("alice")
  })

  it("resolves ${principal.email}", () => {
    expect(resolveTemplate("${principal.email}", ctx)).toBe("alice@example.com")
  })

  it("resolves ${principal.displayName}", () => {
    expect(resolveTemplate("${principal.displayName}", ctx)).toBe("Alice")
  })

  it("resolves ${grant.reason}", () => {
    expect(resolveTemplate("${grant.reason}", ctx)).toBe("test grant")
  })

  it("resolves ${appSlug}", () => {
    expect(resolveTemplate("${appSlug}", ctx)).toBe("nextcloud")
  })

  it("resolves ${roleSlug}", () => {
    expect(resolveTemplate("${roleSlug}", ctx)).toBe("editor")
  })

  it("resolves ${config.X}", () => {
    expect(resolveTemplate("${config.viewerGroup}", ctx)).toBe("nextcloud-user")
    expect(resolveTemplate("${config.adminGroup}", ctx)).toBe("nextcloud-admin")
  })

  it("resolves multiple variables in one string", () => {
    expect(resolveTemplate("${appSlug}-${roleSlug}", ctx)).toBe("nextcloud-editor")
  })

  it("returns plain strings unchanged", () => {
    expect(resolveTemplate("no-vars-here", ctx)).toBe("no-vars-here")
  })

  it("throws TemplateError on unknown variable", () => {
    expect(() => resolveTemplate("${unknown.var}", ctx)).toThrow("Unknown template variable")
  })

  it("throws TemplateError on unknown config key", () => {
    expect(() => resolveTemplate("${config.nonexistent}", ctx)).toThrow("Config key 'nonexistent' not found")
  })

  it("throws TemplateError when variable resolves to null", () => {
    const nullCtx = { ...ctx, principal: { ...ctx.principal, externalId: null } }
    expect(() => resolveTemplate("${principal.externalId}", nullCtx)).toThrow("resolved to null")
  })
})

describe("resolveTemplateObject", () => {
  it("resolves strings recursively in objects", () => {
    const input = { group: "${config.viewerGroup}", user: "${principal.externalId}" }
    expect(resolveTemplateObject(input, ctx)).toEqual({ group: "nextcloud-user", user: "alice" })
  })

  it("resolves strings in arrays", () => {
    const input = ["${appSlug}", "${roleSlug}"]
    expect(resolveTemplateObject(input, ctx)).toEqual(["nextcloud", "editor"])
  })

  it("leaves non-string values untouched", () => {
    expect(resolveTemplateObject(42, ctx)).toBe(42)
    expect(resolveTemplateObject(true, ctx)).toBe(true)
    expect(resolveTemplateObject(null, ctx)).toBe(null)
  })
})
