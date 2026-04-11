import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import type { Route } from "./+types/admin.applications.$id"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { AppSyncService } from "~/lib/governance/AppSyncService.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { activateGrant } from "~/lib/workflows/grant-activation.server"
import type { Role, Entitlement, Resource, Grant, Principal } from "~/lib/governance/types"
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Heading,
  Icon,
  Input,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Table,
  Text,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { AppOverview } from "~/components/AppOverview/AppOverview"
import { QuickGrantDialog } from "~/components/QuickGrantDialog/QuickGrantDialog"

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params }: Route.LoaderArgs) {
  // Parent /admin loader already runs the admin auth check, but a child loader
  // can still be hit independently — keep this defensive.
  const auth = await getAuth(request)
  const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  if (!decision.allow) throw new Response("Forbidden", { status: 403 })

  const appId = params.id

  const data = await runEffect(
    Effect.gen(function* () {
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const grantRepo = yield* GrantRepo
      const principalRepo = yield* PrincipalRepo
      const connectedSystems = yield* ConnectedSystemRepo

      const application = yield* appRepo.findById(appId)
      if (!application) return null

      const roles = yield* rbac.listRoles(appId)
      const entitlements = yield* rbac.listEntitlements(appId)
      const resources = yield* rbac.listResources(appId)
      const grants = yield* grantRepo.findActiveForApp(appId)
      const principals = yield* principalRepo.list()
      const ldapSystem = yield* connectedSystems.findByApplicationAndType(appId, "ldap")
      const ldapProvisioned = ldapSystem !== null && ldapSystem.status === "active"

      return { application, roles, entitlements, resources, grants, principals, ldapProvisioned }
    }),
  )

  if (!data) {
    throw new Response("Application not found", { status: 404 })
  }

  return data
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

async function requireAdminPrincipal(request: Request) {
  const auth = await getAuth(request)
  const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  if (!decision.allow || !auth.user) {
    throw new Response("Forbidden", { status: 403 })
  }
  const principal = await runEffect(
    Effect.gen(function* () {
      const repo = yield* PrincipalRepo
      return yield* repo.findByExternalId(auth.user!)
    }),
  )
  if (!principal) {
    throw new Response("Principal not found for current session", { status: 403 })
  }
  return principal
}

function normalizeExpiresAt(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  // <input type="date"> posts YYYY-MM-DD. Treat as midnight UTC of that day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`
  return raw
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string
  const appId = params.id

  if (intent === "createRole") {
    await requireAdminPrincipal(request)
    const slug = formData.get("slug") as string
    const displayName = formData.get("displayName") as string
    const description = (formData.get("description") as string) || undefined

    if (!slug || !displayName) {
      return { error: "Slug and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createRole(appId, slug, displayName, description)
      }),
    )
    return { success: true }
  }

  if (intent === "createEntitlement") {
    await requireAdminPrincipal(request)
    const slug = formData.get("slug") as string
    const displayName = formData.get("displayName") as string
    const description = (formData.get("description") as string) || undefined

    if (!slug || !displayName) {
      return { error: "Slug and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createEntitlement(appId, slug, displayName, description)
      }),
    )
    return { success: true }
  }

  if (intent === "updateSettings") {
    await requireAdminPrincipal(request)
    const accessMode = formData.get("accessMode") as string | null
    const enabledRaw = formData.get("enabled") as string | null
    const ownerId = (formData.get("ownerId") as string) || undefined

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        const fields: Record<string, unknown> = {}
        if (accessMode) fields.accessMode = accessMode
        fields.enabled = enabledRaw === "true"
        if (ownerId !== undefined) fields.ownerId = ownerId
        yield* repo.update(appId, fields)
      }),
    )
    return { success: true, message: "Settings updated" }
  }

  if (intent === "createResource") {
    await requireAdminPrincipal(request)
    const resourceType = formData.get("resourceType") as string
    const displayName = formData.get("displayName") as string
    const externalId = (formData.get("externalId") as string) || undefined
    const path = (formData.get("path") as string) || undefined

    if (!resourceType || !displayName) {
      return { error: "Resource type and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createResource({
          applicationId: appId,
          resourceType,
          displayName,
          externalId,
          path,
        })
      }),
    )
    return { success: true }
  }

  if (intent === "syncNow") {
    await requireAdminPrincipal(request)
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const sync = yield* AppSyncService
          return yield* sync.syncFromCluster()
        }),
      )
      return {
        success: true,
        message: `Synced ${result.total} apps: ${result.created} created, ${result.updated} updated, ${result.disabled} disabled`,
      }
    } catch (e: any) {
      return { error: e?.message ?? "Sync failed" }
    }
  }

  if (intent === "createGrant") {
    const actor = await requireAdminPrincipal(request)
    const principalId = formData.get("principalId") as string
    const roleId = formData.get("roleId") as string
    const reason = (formData.get("reason") as string) || undefined
    const expiresAt = normalizeExpiresAt((formData.get("expiresAt") as string) || undefined)

    if (!principalId || !roleId) {
      return { error: "Principal and role are required" }
    }

    try {
      await runEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const grantRepo = yield* GrantRepo
          const audit = yield* AuditService
          const grantId = yield* sql.withTransaction(
            Effect.gen(function* () {
              const grant = yield* grantRepo.grantRole({
                principalId,
                roleId,
                grantedBy: actor.id,
                reason,
                expiresAt,
              })
              yield* audit.emit({
                eventType: "grant.created",
                actorId: actor.id,
                targetType: "grant",
                targetId: grant.id,
                applicationId: appId,
                metadata: { roleId, principalId, reason, expiresAt },
              })
              return grant.id
            }),
          )
          // After the grant + audit are committed, enqueue and fork
          // provisioning. Runs outside the transaction so the LDAP connector
          // doesn't hold the DB open during network calls.
          yield* activateGrant(grantId)
        }),
      )
      return { success: true, message: "Grant created" }
    } catch (e: any) {
      return { error: e?.message ?? "Failed to create grant" }
    }
  }

  return { error: "Unknown intent" }
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const roleColumnHelper = createColumnHelper<Role>()
const roleColumns = [
  roleColumnHelper.accessor("slug", { header: "Slug" }),
  roleColumnHelper.accessor("displayName", { header: "Name" }),
  roleColumnHelper.accessor("description", {
    header: "Description",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  roleColumnHelper.accessor("maxDurationHours", {
    header: "Max Duration",
    cell: ({ getValue }) => {
      const v = getValue()
      return v != null ? `${v}h` : "Unlimited"
    },
  }),
]

const entitlementColumnHelper = createColumnHelper<Entitlement>()
const entitlementColumns = [
  entitlementColumnHelper.accessor("slug", { header: "Slug" }),
  entitlementColumnHelper.accessor("displayName", { header: "Name" }),
  entitlementColumnHelper.accessor("description", {
    header: "Description",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

const resourceColumnHelper = createColumnHelper<Resource>()
const resourceColumns = [
  resourceColumnHelper.accessor("displayName", { header: "Name" }),
  resourceColumnHelper.accessor("resourceType", { header: "Type" }),
  resourceColumnHelper.accessor("externalId", {
    header: "External ID",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  resourceColumnHelper.accessor("path", {
    header: "Path",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

interface GrantRow {
  id: string
  principalName: string
  roleName: string
  grantedBy: string
  reason: string | null
  expiresAt: string | null
  createdAt: string
}

const grantColumnHelper = createColumnHelper<GrantRow>()
const grantColumns = [
  grantColumnHelper.accessor("principalName", { header: "Principal" }),
  grantColumnHelper.accessor("roleName", { header: "Role" }),
  grantColumnHelper.accessor("grantedBy", { header: "Granted by" }),
  grantColumnHelper.accessor("reason", {
    header: "Reason",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  grantColumnHelper.accessor("createdAt", {
    header: "Granted at",
    cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
  }),
  grantColumnHelper.accessor("expiresAt", {
    header: "Expires",
    cell: ({ getValue }) => {
      const v = getValue()
      return v ? new Date(v).toLocaleString() : "Never"
    },
  }),
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminApplicationDetailPage({ loaderData }: Route.ComponentProps) {
  const { application, roles, entitlements, resources, grants, principals, ldapProvisioned } = loaderData
  const fetcher = useFetcher()
  const [activeTab, setActiveTab] = useState("overview")
  const settingsFetcher = useFetcher<typeof action>()
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [entitlementDialogOpen, setEntitlementDialogOpen] = useState(false)
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false)
  const [quickGrantOpen, setQuickGrantOpen] = useState(false)

  const isSubmitting = fetcher.state !== "idle"

  const principalNameById = new Map<string, string>(
    (principals as Principal[]).map((p) => [p.id, p.displayName]),
  )
  const roleNameById = new Map<string, string>(roles.map((r) => [r.id, `${r.displayName} (${r.slug})`]))

  const grantRows: GrantRow[] = (grants as Grant[]).map((g) => ({
    id: g.id,
    principalName: principalNameById.get(g.principalId) ?? g.principalId,
    roleName: g.roleId ? (roleNameById.get(g.roleId) ?? g.roleId) : "(entitlement)",
    grantedBy: principalNameById.get(g.grantedBy) ?? g.grantedBy,
    reason: g.reason,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
  }))

  const rolesTable = useReactTable({
    data: roles as Role[],
    columns: roleColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const entitlementsTable = useReactTable({
    data: entitlements as Entitlement[],
    columns: entitlementColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const resourcesTable = useReactTable({
    data: resources as Resource[],
    columns: resourceColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const grantsTable = useReactTable({
    data: grantRows,
    columns: grantColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Stack gap="md">
      <html.div>
        <Heading level={2}>{application.displayName}</Heading>
        <Text color="muted">
          {application.slug} &middot;{" "}
          <Badge
            variant={
              application.accessMode === "open"
                ? "success"
                : application.accessMode === "request"
                  ? "warning"
                  : "default"
            }
          >
            {application.accessMode}
          </Badge>{" "}
          &middot;{" "}
          <Badge variant={application.enabled ? "success" : "default"}>
            {application.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </Text>
        {application.description && <Text>{application.description}</Text>}
      </html.div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="roles">Roles ({roles.length})</Tabs.Tab>
          <Tabs.Tab value="entitlements">Entitlements ({entitlements.length})</Tabs.Tab>
          <Tabs.Tab value="resources">Resources ({resources.length})</Tabs.Tab>
          <Tabs.Tab value="grants">Grants ({grants.length})</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>

        <html.div style={styles.tabContent}>
          {activeTab === "overview" && (
            <AppOverview
              application={application}
              roles={roles as Role[]}
              entitlements={entitlements as Entitlement[]}
              grants={grants as Grant[]}
              onOpenQuickGrant={() => setQuickGrantOpen(true)}
              onSwitchTab={setActiveTab}
            />
          )}

          {activeTab === "roles" && (
            <CardSection
              title="Roles"
              action={
                <Button variant="primary" size="small" onClick={() => setRoleDialogOpen(true)}>
                  Add Role
                </Button>
              }
            >
              {roles.length === 0 ? (
                <EmptyState
                  icon={<Icon name="shield" size={32} />}
                  message="No roles yet. Roles bundle entitlements and are what you grant to people."
                  action={
                    <Button variant="primary" onClick={() => setRoleDialogOpen(true)}>
                      Create your first role
                    </Button>
                  }
                />
              ) : (
                <DataTable table={rolesTable} />
              )}
            </CardSection>
          )}

          {activeTab === "entitlements" && (
            <CardSection
              title="Entitlements"
              action={
                <Button variant="primary" size="small" onClick={() => setEntitlementDialogOpen(true)}>
                  Add Entitlement
                </Button>
              }
            >
              {entitlements.length === 0 ? (
                <EmptyState
                  icon={<Icon name="key" size={32} />}
                  message="No entitlements yet. Entitlements are the discrete permissions roles bundle together."
                  action={
                    <Button variant="primary" onClick={() => setEntitlementDialogOpen(true)}>
                      Create your first entitlement
                    </Button>
                  }
                />
              ) : (
                <DataTable table={entitlementsTable} />
              )}
            </CardSection>
          )}

          {activeTab === "resources" && (
            <CardSection
              title="Resources"
              action={
                <Button variant="primary" size="small" onClick={() => setResourceDialogOpen(true)}>
                  Add Resource
                </Button>
              }
            >
              {resources.length === 0 ? (
                <EmptyState
                  icon={<Icon name="lock" size={32} />}
                  message="No resources yet. Resources scope grants to specific objects (folders, projects, etc)."
                  action={
                    <Button variant="primary" onClick={() => setResourceDialogOpen(true)}>
                      Create your first resource
                    </Button>
                  }
                />
              ) : (
                <DataTable table={resourcesTable} />
              )}
            </CardSection>
          )}

          {activeTab === "grants" && (
            <CardSection
              title="Active grants"
              action={
                <Button variant="primary" size="small" onClick={() => setQuickGrantOpen(true)}>
                  Grant access
                </Button>
              }
            >
              {grantRows.length === 0 ? (
                <EmptyState
                  icon={<Icon name="check-circle" size={32} />}
                  message="No active grants for this application yet."
                  action={
                    <Button variant="primary" onClick={() => setQuickGrantOpen(true)}>
                      Grant your first access
                    </Button>
                  }
                />
              ) : (
                <DataTable table={grantsTable} />
              )}
            </CardSection>
          )}

          {activeTab === "settings" && (
            <CardSection title="Application Settings">
              {settingsFetcher.data && "message" in settingsFetcher.data && (
                <Alert variant="success">{settingsFetcher.data.message}</Alert>
              )}
              <settingsFetcher.Form method="post">
                <input type="hidden" name="intent" value="updateSettings" />
                <Stack gap="md">
                  <Field.Root>
                    <Field.Label>Slug</Field.Label>
                    <Input value={application.slug} disabled />
                    <Field.Description>Synced from Kubernetes — read only</Field.Description>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Display Name</Field.Label>
                    <Input value={application.displayName} disabled />
                    <Field.Description>Synced from Kubernetes — read only</Field.Description>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Access Mode</Field.Label>
                    <Select.Root name="accessMode" defaultValue={application.accessMode}>
                      <Select.Trigger aria-label="Access Mode">
                        <Select.Value placeholder="Select access mode" />
                        <Select.Icon />
                      </Select.Trigger>
                      <Select.Popup>
                        <Select.Item value="open">
                          <Select.ItemText>Open</Select.ItemText>
                        </Select.Item>
                        <Select.Item value="request">
                          <Select.ItemText>Request</Select.ItemText>
                        </Select.Item>
                        <Select.Item value="invite_only">
                          <Select.ItemText>Invite Only</Select.ItemText>
                        </Select.Item>
                      </Select.Popup>
                    </Select.Root>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Enabled</Field.Label>
                    <input type="hidden" name="enabled" value={application.enabled ? "true" : "false"} />
                    <Checkbox
                      name="enabled"
                      value="true"
                      defaultChecked={application.enabled}
                      onChange={(e: any) => {
                        const hidden = e.target.form?.querySelector('input[name="enabled"][type="hidden"]')
                        if (hidden) hidden.value = e.target.checked ? "true" : "false"
                      }}
                    >
                      Application is enabled
                    </Checkbox>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Owner</Field.Label>
                    <Input name="ownerId" defaultValue={application.ownerId ?? ""} placeholder="Principal ID" />
                  </Field.Root>
                  <Button type="submit" variant="primary" disabled={settingsFetcher.state !== "idle"}>
                    {settingsFetcher.state !== "idle" ? "Saving..." : "Save Settings"}
                  </Button>
                </Stack>
              </settingsFetcher.Form>
            </CardSection>
          )}
        </html.div>
      </Tabs.Root>

      <QuickGrantDialog
        open={quickGrantOpen}
        onOpenChange={setQuickGrantOpen}
        roles={roles as Role[]}
        principals={principals as Principal[]}
        applicationSlug={application.slug}
        ldapProvisioned={ldapProvisioned}
        onGoToRoles={() => setActiveTab("roles")}
      />

      {/* Create Role Dialog */}
      <Dialog.Root open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Role</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setRoleDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createRole" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Slug</Field.Label>
                  <Input name="slug" placeholder="admin" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="Administrator" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input name="description" placeholder="Optional description" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Role"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Create Entitlement Dialog */}
      <Dialog.Root open={entitlementDialogOpen} onOpenChange={setEntitlementDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Entitlement</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setEntitlementDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createEntitlement" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Slug</Field.Label>
                  <Input name="slug" placeholder="read" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="Read Access" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input name="description" placeholder="Optional description" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Entitlement"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Create Resource Dialog */}
      <Dialog.Root open={resourceDialogOpen} onOpenChange={setResourceDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Resource</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setResourceDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createResource" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Resource Type</Field.Label>
                  <Input name="resourceType" placeholder="folder" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="Documents" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>External ID</Field.Label>
                  <Input name="externalId" placeholder="Optional external identifier" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Path</Field.Label>
                  <Input name="path" placeholder="/documents" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Resource"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  )
}

/** Reusable table renderer for any TanStack table instance */
function DataTable<T>({ table }: { table: ReturnType<typeof useReactTable<T>> }) {
  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport>
        <ScrollArea.Content>
          <Table.Root>
            <Table.Header>
              {table.getHeaderGroups().map((headerGroup) => (
                <Table.Row key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <Table.HeaderCell key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </Table.HeaderCell>
                  ))}
                </Table.Row>
              ))}
            </Table.Header>
            <Table.Body>
              {table.getRowModel().rows.map((row) => (
                <Table.Row key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <Table.Cell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb orientation="horizontal" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}

const styles = css.create({
  tabContent: {
    paddingTop: spacing.md,
  },
})
