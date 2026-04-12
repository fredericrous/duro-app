import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Shared coercions (PGlite returns booleans as 0/1 and dates as Date objects)
// ---------------------------------------------------------------------------

export const Coerced = {
  Boolean: Schema.transform(Schema.Unknown, Schema.Boolean, {
    decode: (v) => !!v,
    encode: (v) => v,
  }),
  NullableString: Schema.NullOr(Schema.String),
  NullableNumber: Schema.NullOr(Schema.Number),
  DateString: Schema.transform(Schema.Unknown, Schema.String, {
    decode: (v) => (v instanceof Date ? v.toISOString() : String(v)),
    encode: (v) => v,
  }),
  NullableDateString: Schema.transform(Schema.Unknown, Schema.NullOr(Schema.String), {
    decode: (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v)),
    encode: (v) => v,
  }),
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PrincipalType = Schema.Literal("user", "group", "service_account", "device")
export type PrincipalType = typeof PrincipalType.Type

export const AccessMode = Schema.Literal("open", "request", "invite_only")
export type AccessMode = typeof AccessMode.Type

export const RequestStatus = Schema.Literal("pending", "approved", "rejected", "cancelled", "expired")
export type RequestStatus = typeof RequestStatus.Type

export const ApprovalDecision = Schema.Literal("approved", "rejected")
export type ApprovalDecision = typeof ApprovalDecision.Type

export const ApprovalMode = Schema.Literal("none", "one_of", "all_of")
export type ApprovalMode = typeof ApprovalMode.Type

export const ApprovalScopeType = Schema.Literal("application", "role", "entitlement", "resource")
export type ApprovalScopeType = typeof ApprovalScopeType.Type

export const InvitationStatus = Schema.Literal("pending", "accepted", "declined", "expired")
export type InvitationStatus = typeof InvitationStatus.Type

export const ConnectorType = Schema.Literal("http", "ldap", "scim", "webhook")
export type ConnectorType = typeof ConnectorType.Type

export const ConnectorStatus = Schema.Literal("active", "disabled", "error")
export type ConnectorStatus = typeof ConnectorStatus.Type

export const ConnectorDirection = Schema.Literal("push", "pull", "bidirectional")
export type ConnectorDirection = typeof ConnectorDirection.Type

export const JobOperation = Schema.Literal("provision", "deprovision")
export type JobOperation = typeof JobOperation.Type

export const JobStatus = Schema.Literal("pending", "running", "completed", "failed")
export type JobStatus = typeof JobStatus.Type

// ---------------------------------------------------------------------------
// Row schemas (decode DB rows → typed objects)
// ---------------------------------------------------------------------------

export const PrincipalRow = Schema.Struct({
  id: Schema.String,
  principalType: Schema.String,
  externalId: Coerced.NullableString,
  displayName: Schema.String,
  email: Coerced.NullableString,
  enabled: Coerced.Boolean,
  createdAt: Coerced.DateString,
  updatedAt: Coerced.DateString,
})
export type Principal = typeof PrincipalRow.Type

export const ApplicationRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  displayName: Schema.String,
  description: Coerced.NullableString,
  accessMode: Schema.String,
  ownerId: Coerced.NullableString,
  enabled: Coerced.Boolean,
  createdAt: Coerced.DateString,
  updatedAt: Coerced.DateString,
  lastSyncedAt: Coerced.NullableDateString,
})
export type Application = typeof ApplicationRow.Type

export const ResourceRow = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  parentResourceId: Coerced.NullableString,
  resourceType: Schema.String,
  externalId: Coerced.NullableString,
  displayName: Schema.String,
  path: Coerced.NullableString,
  createdAt: Coerced.DateString,
})
export type Resource = typeof ResourceRow.Type

export const RoleRow = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  slug: Schema.String,
  displayName: Schema.String,
  description: Coerced.NullableString,
  maxDurationHours: Coerced.NullableNumber,
  createdAt: Coerced.DateString,
})
export type Role = typeof RoleRow.Type

export const EntitlementRow = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  slug: Schema.String,
  displayName: Schema.String,
  description: Coerced.NullableString,
  createdAt: Coerced.DateString,
})
export type Entitlement = typeof EntitlementRow.Type

export const GrantRow = Schema.Struct({
  id: Schema.String,
  principalId: Schema.String,
  roleId: Coerced.NullableString,
  entitlementId: Coerced.NullableString,
  resourceId: Coerced.NullableString,
  grantedBy: Schema.String,
  reason: Coerced.NullableString,
  expiresAt: Coerced.NullableDateString,
  revokedAt: Coerced.NullableDateString,
  revokedBy: Coerced.NullableString,
  createdAt: Coerced.DateString,
})
export type Grant = typeof GrantRow.Type

export const AccessRequestRow = Schema.Struct({
  id: Schema.String,
  requesterId: Schema.String,
  applicationId: Schema.String,
  roleId: Coerced.NullableString,
  entitlementId: Coerced.NullableString,
  resourceId: Coerced.NullableString,
  justification: Coerced.NullableString,
  requestedDurationHours: Coerced.NullableNumber,
  status: Schema.String,
  resolvedAt: Coerced.NullableDateString,
  grantId: Coerced.NullableString,
  createdAt: Coerced.DateString,
  expiresAt: Coerced.NullableDateString,
})
export type AccessRequest = typeof AccessRequestRow.Type

export const RequestApprovalRow = Schema.Struct({
  id: Schema.String,
  requestId: Schema.String,
  approverId: Schema.String,
  decision: Coerced.NullableString,
  comment: Coerced.NullableString,
  decidedAt: Coerced.NullableDateString,
})
export type RequestApproval = typeof RequestApprovalRow.Type

export const ApprovalPolicyRow = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  scopeType: Schema.String,
  scopeId: Coerced.NullableString,
  mode: Schema.String,
  rules: Schema.Unknown, // JSONB
  createdAt: Coerced.DateString,
  updatedAt: Coerced.DateString,
})
export type ApprovalPolicy = typeof ApprovalPolicyRow.Type

export const AccessInvitationRow = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  roleId: Coerced.NullableString,
  entitlementId: Coerced.NullableString,
  resourceId: Coerced.NullableString,
  invitedPrincipalId: Schema.String,
  invitedBy: Schema.String,
  message: Coerced.NullableString,
  status: Schema.String,
  grantId: Coerced.NullableString,
  createdAt: Coerced.DateString,
  expiresAt: Coerced.NullableDateString,
  resolvedAt: Coerced.NullableDateString,
})
export type AccessInvitation = typeof AccessInvitationRow.Type

export const AuditEventRow = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  actorId: Coerced.NullableString,
  targetType: Coerced.NullableString,
  targetId: Coerced.NullableString,
  applicationId: Coerced.NullableString,
  metadata: Schema.Unknown, // JSONB
  ipAddress: Coerced.NullableString,
  createdAt: Coerced.DateString,
})
export type AuditEvent = typeof AuditEventRow.Type

export const ApiKeyRow = Schema.Struct({
  id: Schema.String,
  principalId: Schema.String,
  keyHash: Schema.String,
  name: Schema.String,
  scopes: Schema.Unknown, // JSONB
  expiresAt: Coerced.NullableDateString,
  revokedAt: Coerced.NullableDateString,
  createdAt: Coerced.DateString,
})
export type ApiKey = typeof ApiKeyRow.Type

export const GroupMappingRow = Schema.Struct({
  id: Schema.String,
  oidcGroupName: Schema.String,
  principalGroupId: Coerced.NullableString,
  roleId: Coerced.NullableString,
  applicationId: Coerced.NullableString,
  createdAt: Coerced.DateString,
})
export type GroupMapping = typeof GroupMappingRow.Type

export const ConnectedSystemRow = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  connectorType: Schema.String,
  config: Schema.Unknown, // JSONB
  status: Schema.String,
  pluginSlug: Coerced.NullableString,
  pluginVersion: Coerced.NullableString,
  lastSyncAt: Coerced.NullableDateString,
  lastError: Coerced.NullableString,
  createdAt: Coerced.DateString,
  updatedAt: Coerced.DateString,
})
export type ConnectedSystem = typeof ConnectedSystemRow.Type

export const ConnectorMappingRow = Schema.Struct({
  id: Schema.String,
  connectedSystemId: Schema.String,
  localRoleId: Coerced.NullableString,
  localEntitlementId: Coerced.NullableString,
  externalRoleIdentifier: Schema.String,
  direction: Schema.String,
  createdAt: Coerced.DateString,
})
export type ConnectorMapping = typeof ConnectorMappingRow.Type

export const ProvisioningJobRow = Schema.Struct({
  id: Schema.String,
  connectedSystemId: Schema.String,
  grantId: Schema.String,
  operation: Schema.String,
  status: Schema.String,
  attempts: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  lastError: Coerced.NullableString,
  startedAt: Coerced.NullableDateString,
  completedAt: Coerced.NullableDateString,
  createdAt: Coerced.DateString,
})
export type ProvisioningJob = typeof ProvisioningJobRow.Type

// ---------------------------------------------------------------------------
// Row decoders
// ---------------------------------------------------------------------------

export const decodePrincipal = Schema.decodeUnknownSync(PrincipalRow)
export const decodeApplication = Schema.decodeUnknownSync(ApplicationRow)
export const decodeResource = Schema.decodeUnknownSync(ResourceRow)
export const decodeRole = Schema.decodeUnknownSync(RoleRow)
export const decodeEntitlement = Schema.decodeUnknownSync(EntitlementRow)
export const decodeGrant = Schema.decodeUnknownSync(GrantRow)
export const decodeAccessRequest = Schema.decodeUnknownSync(AccessRequestRow)
export const decodeRequestApproval = Schema.decodeUnknownSync(RequestApprovalRow)
export const decodeApprovalPolicy = Schema.decodeUnknownSync(ApprovalPolicyRow)
export const decodeAccessInvitation = Schema.decodeUnknownSync(AccessInvitationRow)
export const decodeAuditEvent = Schema.decodeUnknownSync(AuditEventRow)
export const decodeApiKey = Schema.decodeUnknownSync(ApiKeyRow)
export const decodeGroupMapping = Schema.decodeUnknownSync(GroupMappingRow)
export const decodeConnectedSystem = Schema.decodeUnknownSync(ConnectedSystemRow)
export const decodeConnectorMapping = Schema.decodeUnknownSync(ConnectorMappingRow)
export const decodeProvisioningJob = Schema.decodeUnknownSync(ProvisioningJobRow)

// ---------------------------------------------------------------------------
// AuthzEngine types
// ---------------------------------------------------------------------------

export interface AccessCheck {
  readonly subject: string
  readonly application: string
  readonly action: string
  readonly resourceId?: string
  readonly context?: Record<string, string>
}

export interface AccessDecision {
  readonly allow: boolean
  readonly matchedGrantIds: readonly string[]
  readonly reasons: readonly string[]
  readonly diagnostics?: {
    readonly principalId: string
    readonly groupIds: readonly string[]
    readonly candidateGrantCount: number
    readonly evaluationMs: number
  }
}

// ---------------------------------------------------------------------------
// Approval policy rule types (stored as JSONB in approval_policies.rules)
// ---------------------------------------------------------------------------

export interface ApprovalPolicyRule {
  readonly approverType: "app_owner" | "principal"
  readonly approverPrincipalId?: string
}
