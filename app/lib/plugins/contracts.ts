import { Effect, Schema } from "effect"
import type { Grant, Role, Principal } from "~/lib/governance/types"
import type { PluginError, ScopeViolation } from "./errors"

// ---------------------------------------------------------------------------
// Capabilities — what a plugin is allowed to touch
// ---------------------------------------------------------------------------

export const PLUGIN_CAPABILITIES = [
  "lldap.group.read",
  "lldap.group.member.add",
  "lldap.group.member.remove",
  "http.call",
  "vault.secret.read",
] as const

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

// ---------------------------------------------------------------------------
// Atomic actions for declarative permission strategies
// ---------------------------------------------------------------------------

export type LldapAddGroupMember = {
  readonly op: "lldap.addGroupMember"
  readonly group: string
  readonly user: string
  readonly reversible: true
}

export type LldapRemoveGroupMember = {
  readonly op: "lldap.removeGroupMember"
  readonly group: string
  readonly user: string
  readonly reversible: true
}

export type HttpPost = {
  readonly op: "http.post"
  readonly url: string
  readonly body: unknown
  readonly secret?: string
  readonly reversible: false
}

export type HttpPut = {
  readonly op: "http.put"
  readonly url: string
  readonly body: unknown
  readonly secret?: string
  readonly reversible: false
}

export type HttpDelete = {
  readonly op: "http.delete"
  readonly url: string
  readonly secret?: string
  readonly reversible: false
}

export type HttpGet = {
  readonly op: "http.get"
  readonly url: string
  readonly secret?: string
  readonly reversible: false
}

export type PluginAction =
  | LldapAddGroupMember
  | LldapRemoveGroupMember
  | HttpPost
  | HttpPut
  | HttpDelete
  | HttpGet

/** True if the action can be auto-reversed by the host on deprovision. */
export function isReversible(action: PluginAction): boolean {
  return action.reversible
}

/** Returns the inverse action for reversible ops. Throws on non-reversible. */
export function reverseAction(action: PluginAction): PluginAction {
  if (action.op === "lldap.addGroupMember") {
    return { op: "lldap.removeGroupMember", group: action.group, user: action.user, reversible: true }
  }
  if (action.op === "lldap.removeGroupMember") {
    return { op: "lldap.addGroupMember", group: action.group, user: action.user, reversible: true }
  }
  throw new Error(`Action ${action.op} is not reversible`)
}

// ---------------------------------------------------------------------------
// Permission strategy — the data structure the host interprets
// ---------------------------------------------------------------------------

export interface PermissionStrategy {
  readonly byRoleSlug: Readonly<Record<string, ReadonlyArray<PluginAction>>>
}

// ---------------------------------------------------------------------------
// Plugin manifest — static metadata, validated at startup
// ---------------------------------------------------------------------------

export interface PluginManifest {
  readonly slug: string
  readonly version: string
  readonly displayName: string
  readonly description: string
  readonly capabilities: ReadonlyArray<PluginCapability>
  readonly allowedDomains: ReadonlyArray<string>
  readonly ownedLldapGroups: ReadonlyArray<string>
  readonly vaultSecrets: ReadonlyArray<string>
  readonly configSchema: Schema.Schema<unknown, unknown>
  readonly permissionStrategy: PermissionStrategy
  readonly imperative: boolean
  readonly timeoutMs: number
}

// ---------------------------------------------------------------------------
// Scoped services — the sandbox plugins operate inside
// ---------------------------------------------------------------------------

export interface ScopedLldapClient {
  readonly addUserToGroup: (userId: string, groupName: string) => Effect.Effect<void, ScopeViolation>
  readonly removeUserFromGroup: (userId: string, groupName: string) => Effect.Effect<void, ScopeViolation>
  readonly findGroupByName: (groupName: string) => Effect.Effect<{ id: number; displayName: string } | null, ScopeViolation>
}

export interface HttpCallOpts {
  /** Vault secret logical name for auth token injection. */
  readonly secret?: string
  /**
   * Auth header format. Defaults to "Authorization: token {value}" (Gitea).
   * Set to a header name (e.g. "x-api-key") for non-standard auth, or
   * "Bearer" for standard OAuth bearer.
   */
  readonly authHeader?: string
}

export interface ScopedHttpClient {
  readonly get: (url: string, opts?: HttpCallOpts) => Effect.Effect<unknown, PluginError>
  readonly post: (url: string, body: unknown, opts?: HttpCallOpts) => Effect.Effect<unknown, PluginError>
  readonly put: (url: string, body: unknown, opts?: HttpCallOpts) => Effect.Effect<unknown, PluginError>
  readonly del: (url: string, opts?: HttpCallOpts) => Effect.Effect<void, PluginError>
}

export interface ScopedVaultClient {
  readonly readSecret: (logicalName: string) => Effect.Effect<string, ScopeViolation>
}

export interface ScopedAuditService {
  readonly emit: (event: {
    eventType: string
    metadata?: Record<string, unknown>
  }) => Effect.Effect<void>
}

export interface PluginServices {
  readonly lldap: ScopedLldapClient
  readonly http: ScopedHttpClient
  readonly vault: ScopedVaultClient
  readonly audit: ScopedAuditService
  readonly log: (message: string, annotations?: Record<string, unknown>) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Grant context — what the host passes to each plugin invocation
// ---------------------------------------------------------------------------

export interface GrantContext {
  readonly grant: Grant
  readonly role: Role
  readonly principal: Principal
  readonly applicationId: string
  readonly applicationSlug: string
  readonly config: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Plugin — the actual contract a plugin module exports
// ---------------------------------------------------------------------------

export interface Plugin {
  readonly manifest: PluginManifest
  readonly provision?: (ctx: GrantContext, svc: PluginServices) => Effect.Effect<void, PluginError>
  readonly deprovision?: (ctx: GrantContext, svc: PluginServices) => Effect.Effect<void, PluginError>
  readonly healthCheck?: (svc: PluginServices) => Effect.Effect<"healthy" | "degraded" | "unhealthy", PluginError>
}
