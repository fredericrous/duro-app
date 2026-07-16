import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useFetcher, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
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
import { AccessRequestRepo, type AccessRequestEnriched } from "~/lib/governance/AccessRequestRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { AppSyncService } from "~/lib/governance/AppSyncService.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { activateGrant } from "~/lib/workflows/grant-activation.server"
import type { Role, Entitlement, Resource, Grant, Principal } from "~/lib/governance/types"
import { useReactTable, getCoreRowModel, createColumnHelper } from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Heading,
  Icon,
  Inline,
  Input,
  Select,
  Stack,
  Tabs,
  Table,
  Text,
  useToast,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { AnimatedNumber } from "~/components/motion/AnimatedNumber"
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

      const requestRepo = yield* AccessRequestRepo

      const application = yield* appRepo.findById(appId)
      if (!application) return null

      const roles = yield* rbac.listRoles(appId)
      const entitlements = yield* rbac.listEntitlements(appId)
      const resources = yield* rbac.listResources(appId)
      const grants = yield* grantRepo.findActiveForApp(appId)
      const principals = yield* principalRepo.list()
      const pendingRequests = yield* requestRepo.listAllEnriched({ applicationId: appId, status: "pending" })
      const pluginSystem = yield* connectedSystems.findByApplicationAndType(appId, "plugin")
      const ldapProvisioned = pluginSystem !== null && pluginSystem.status === "active"

      const pluginInfo = pluginSystem?.pluginSlug
        ? { pluginSlug: pluginSystem.pluginSlug, pluginVersion: pluginSystem.pluginVersion ?? "?" }
        : null

      return {
        application,
        roles,
        entitlements,
        resources,
        grants,
        principals,
        pendingRequests,
        ldapProvisioned,
        pluginInfo,
      }
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
  if (!decision.allow || !auth.sub) {
    throw new Response("Forbidden", { status: 403 })
  }
  const principal = await runEffect(
    Effect.gen(function* () {
      const repo = yield* PrincipalRepo
      return yield* repo.findByExternalId(auth.sub!)
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
      return { error: "slug_and_name_required" as const }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createRole(appId, slug, displayName, description)
      }),
    )
    return { success: true, message: "role_created" as const }
  }

  if (intent === "createEntitlement") {
    await requireAdminPrincipal(request)
    const slug = formData.get("slug") as string
    const displayName = formData.get("displayName") as string
    const description = (formData.get("description") as string) || undefined

    if (!slug || !displayName) {
      return { error: "slug_and_name_required" as const }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createEntitlement(appId, slug, displayName, description)
      }),
    )
    return { success: true, message: "entitlement_created" as const }
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
    return { success: true, message: "settings_updated" as const }
  }

  if (intent === "createResource") {
    await requireAdminPrincipal(request)
    const resourceType = formData.get("resourceType") as string
    const displayName = formData.get("displayName") as string
    const externalId = (formData.get("externalId") as string) || undefined
    const path = (formData.get("path") as string) || undefined

    if (!resourceType || !displayName) {
      return { error: "resource_type_and_name_required" as const }
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
    return { success: true, message: "resource_created" as const }
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
        message: "synced" as const,
        total: result.total,
        created: result.created,
        updated: result.updated,
        disabled: result.disabled,
      }
    } catch (e) {
      return { error: "sync_failed" as const, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  if (intent === "createGrant") {
    const actor = await requireAdminPrincipal(request)
    const principalId = formData.get("principalId") as string
    const roleId = formData.get("roleId") as string
    const reason = (formData.get("reason") as string) || undefined
    const expiresAt = normalizeExpiresAt((formData.get("expiresAt") as string) || undefined)

    if (!principalId || !roleId) {
      return { error: "principal_and_role_required" as const }
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
      return { success: true, message: "grant_created" as const }
    } catch (e) {
      return { error: "grant_failed" as const, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  return { error: "Unknown intent" }
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const roleColumnHelper = createColumnHelper<Role>()
const buildRoleColumns = (t: TFunction) => [
  roleColumnHelper.accessor("slug", { header: t("admin.cols.slug") }),
  roleColumnHelper.accessor("displayName", { header: t("admin.cols.name") }),
  roleColumnHelper.accessor("description", {
    header: t("admin.cols.description"),
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  roleColumnHelper.accessor("maxDurationHours", {
    header: t("admin.cols.maxDuration"),
    cell: ({ getValue }) => {
      const v = getValue()
      return v != null ? `${v}h` : t("admin.applications.unlimited")
    },
  }),
]

const entitlementColumnHelper = createColumnHelper<Entitlement>()
const buildEntitlementColumns = (t: TFunction) => [
  entitlementColumnHelper.accessor("slug", { header: t("admin.cols.slug") }),
  entitlementColumnHelper.accessor("displayName", { header: t("admin.cols.name") }),
  entitlementColumnHelper.accessor("description", {
    header: t("admin.cols.description"),
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

const resourceColumnHelper = createColumnHelper<Resource>()
const buildResourceColumns = (t: TFunction) => [
  resourceColumnHelper.accessor("displayName", { header: t("admin.cols.name") }),
  resourceColumnHelper.accessor("resourceType", { header: t("admin.cols.type") }),
  resourceColumnHelper.accessor("externalId", {
    header: t("admin.cols.externalId"),
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  resourceColumnHelper.accessor("path", {
    header: t("admin.cols.path"),
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
const buildGrantColumns = (t: TFunction) => [
  grantColumnHelper.accessor("principalName", { header: t("admin.cols.principal") }),
  grantColumnHelper.accessor("roleName", { header: t("admin.cols.role") }),
  grantColumnHelper.accessor("grantedBy", { header: t("admin.cols.grantedBy") }),
  grantColumnHelper.accessor("reason", {
    header: t("admin.cols.reason"),
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  grantColumnHelper.accessor("createdAt", {
    header: t("admin.cols.grantedAt"),
    cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
  }),
  grantColumnHelper.accessor("expiresAt", {
    header: t("admin.cols.expires"),
    cell: ({ getValue }) => {
      const v = getValue()
      return v ? new Date(v).toLocaleString() : t("admin.cols.never")
    },
  }),
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminApplicationDetailPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const {
    application,
    roles,
    entitlements,
    resources,
    grants,
    principals,
    pendingRequests,
    ldapProvisioned,
    pluginInfo,
  } = loaderData
  const fetcher = useFetcher()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get("tab") ?? "overview"
  const [activeTab, setActiveTab] = useState(initialTab)
  const settingsFetcher = useFetcher<typeof action>()
  const { toast } = useToast()
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [entitlementDialogOpen, setEntitlementDialogOpen] = useState(false)
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false)
  const [quickGrantOpen, setQuickGrantOpen] = useState(searchParams.get("grant") === "open")

  // If we landed here from /admin/grants → "Create Grant", clear the deep-link
  // params so the dialog state isn't replayed on reload or back-navigation.
  useEffect(() => {
    if (searchParams.get("grant") || searchParams.get("tab")) {
      const next = new URLSearchParams(searchParams)
      next.delete("grant")
      next.delete("tab")
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Surface action results (create role/entitlement/resource, settings save) as
  // transient toasts instead of layout-shifting inline alerts. The identity
  // guard fires each result exactly once (incl. React StrictMode remounts).
  const lastCreateResult = useRef<unknown>(null)
  useEffect(() => {
    const d = fetcher.data as { success?: boolean; message?: string; error?: string } | undefined
    if (fetcher.state !== "idle" || !d || lastCreateResult.current === d) return
    lastCreateResult.current = d
    if (d.success && d.message) toast({ variant: "success", message: t(`admin.applications.action.${d.message}`) })
    else if (d.error) toast({ variant: "error", message: t(`admin.applications.action.${d.error}`) })
  }, [fetcher.state, fetcher.data, toast, t])

  const lastSettingsResult = useRef<unknown>(null)
  useEffect(() => {
    const d = settingsFetcher.data
    if (settingsFetcher.state !== "idle" || !d || lastSettingsResult.current === d) return
    lastSettingsResult.current = d
    if ("message" in d && d.message) toast({ variant: "success", message: t(`admin.applications.action.${d.message}`) })
  }, [settingsFetcher.state, settingsFetcher.data, toast, t])

  const isSubmitting = fetcher.state !== "idle"

  const principalNameById = new Map<string, string>((principals as Principal[]).map((p) => [p.id, p.displayName]))
  const roleNameById = new Map<string, string>(roles.map((r) => [r.id, `${r.displayName} (${r.slug})`]))

  const grantRows: GrantRow[] = (grants as Grant[]).map((g) => ({
    id: g.id,
    principalName: principalNameById.get(g.principalId) ?? g.principalId,
    roleName: g.roleId ? (roleNameById.get(g.roleId) ?? g.roleId) : t("admin.applications.entitlementLabel"),
    grantedBy: principalNameById.get(g.grantedBy) ?? g.grantedBy,
    reason: g.reason,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
  }))

  const roleColumns = useMemo(() => buildRoleColumns(t), [t])
  const entitlementColumns = useMemo(() => buildEntitlementColumns(t), [t])
  const resourceColumns = useMemo(() => buildResourceColumns(t), [t])
  const grantColumns = useMemo(() => buildGrantColumns(t), [t])

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
            {t(`common.enums.accessMode.${application.accessMode}`)}
          </Badge>{" "}
          &middot;{" "}
          <Badge variant={application.enabled ? "success" : "default"}>
            {application.enabled ? t("admin.cols.enabled") : t("admin.cols.disabled")}
          </Badge>
        </Text>
        {application.description && <Text>{application.description}</Text>}
      </html.div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="overview">{t("admin.applications.tabs.overview")}</Tabs.Tab>
          <Tabs.Tab value="roles">
            {t("admin.applications.tabs.roles")} (<AnimatedNumber value={roles.length} />)
          </Tabs.Tab>
          <Tabs.Tab value="entitlements">
            {t("admin.applications.tabs.entitlements")} (<AnimatedNumber value={entitlements.length} />)
          </Tabs.Tab>
          <Tabs.Tab value="resources">
            {t("admin.applications.tabs.resources")} (<AnimatedNumber value={resources.length} />)
          </Tabs.Tab>
          <Tabs.Tab value="grants">
            {t("admin.applications.tabs.grants")} (<AnimatedNumber value={grants.length} />)
          </Tabs.Tab>
          <Tabs.Tab value="requests">
            {t("admin.applications.tabs.requests")} (<AnimatedNumber value={pendingRequests.length} />)
          </Tabs.Tab>
          <Tabs.Tab value="settings">{t("admin.applications.tabs.settings")}</Tabs.Tab>
        </Tabs.List>

        <html.div style={styles.tabContent}>
          {activeTab === "overview" && (
            <Stack gap="md">
              {pendingRequests.length > 0 && (
                <Callout variant="info">
                  <Inline gap="sm" align="center" justify="between">
                    <Text>{t("admin.applications.pendingReview", { count: pendingRequests.length })}</Text>
                    <Button variant="secondary" size="small" onClick={() => setActiveTab("requests")}>
                      {t("admin.applications.review")}
                    </Button>
                  </Inline>
                </Callout>
              )}
              <AppOverview
                application={application}
                roles={roles as Role[]}
                entitlements={entitlements as Entitlement[]}
                grants={grants as Grant[]}
                pluginInfo={pluginInfo}
                onOpenQuickGrant={() => setQuickGrantOpen(true)}
                onSwitchTab={setActiveTab}
              />
            </Stack>
          )}

          {activeTab === "roles" && (
            <CardSection
              title={t("admin.applications.sections.roles")}
              action={
                <Button variant="primary" size="small" onClick={() => setRoleDialogOpen(true)}>
                  {t("admin.applications.addRole")}
                </Button>
              }
            >
              {roles.length === 0 ? (
                <EmptyState
                  icon={<Icon name="shield" size={32} />}
                  message={t("admin.applications.empty.roles")}
                  action={
                    <Button variant="primary" onClick={() => setRoleDialogOpen(true)}>
                      {t("admin.applications.createFirstRole")}
                    </Button>
                  }
                />
              ) : (
                <Table.FromTanstack table={rolesTable} />
              )}
            </CardSection>
          )}

          {activeTab === "entitlements" && (
            <CardSection
              title={t("admin.applications.sections.entitlements")}
              action={
                <Button variant="primary" size="small" onClick={() => setEntitlementDialogOpen(true)}>
                  {t("admin.applications.addEntitlement")}
                </Button>
              }
            >
              {entitlements.length === 0 ? (
                <EmptyState
                  icon={<Icon name="key" size={32} />}
                  message={t("admin.applications.empty.entitlements")}
                  action={
                    <Button variant="primary" onClick={() => setEntitlementDialogOpen(true)}>
                      {t("admin.applications.createFirstEntitlement")}
                    </Button>
                  }
                />
              ) : (
                <Table.FromTanstack table={entitlementsTable} />
              )}
            </CardSection>
          )}

          {activeTab === "resources" && (
            <CardSection
              title={t("admin.applications.sections.resources")}
              action={
                <Button variant="primary" size="small" onClick={() => setResourceDialogOpen(true)}>
                  {t("admin.applications.addResource")}
                </Button>
              }
            >
              {resources.length === 0 ? (
                <EmptyState
                  icon={<Icon name="lock" size={32} />}
                  message={t("admin.applications.empty.resources")}
                  action={
                    <Button variant="primary" onClick={() => setResourceDialogOpen(true)}>
                      {t("admin.applications.createFirstResource")}
                    </Button>
                  }
                />
              ) : (
                <Table.FromTanstack table={resourcesTable} />
              )}
            </CardSection>
          )}

          {activeTab === "grants" && (
            <CardSection
              title={t("admin.applications.sections.grants")}
              action={
                <Button variant="primary" size="small" onClick={() => setQuickGrantOpen(true)}>
                  {t("admin.applications.grantAccess")}
                </Button>
              }
            >
              {grantRows.length === 0 ? (
                <EmptyState
                  icon={<Icon name="check-circle" size={32} />}
                  message={t("admin.applications.empty.grants")}
                  action={
                    <Button variant="primary" onClick={() => setQuickGrantOpen(true)}>
                      {t("admin.applications.grantFirstAccess")}
                    </Button>
                  }
                />
              ) : (
                <Table.FromTanstack table={grantsTable} />
              )}
            </CardSection>
          )}

          {activeTab === "requests" && (
            <CardSection title={t("admin.applications.sections.requests")}>
              {pendingRequests.length === 0 ? (
                <EmptyState
                  icon={<Icon name="check-circle" size={32} />}
                  message={t("admin.applications.empty.requests")}
                />
              ) : (
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("admin.cols.requester")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.cols.role")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.cols.entitlement")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.cols.justification")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.cols.created")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.cols.action")}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {(pendingRequests as AccessRequestEnriched[]).map((r) => (
                      <Table.Row key={r.id}>
                        <Table.Cell>{r.requesterName ?? r.requesterId}</Table.Cell>
                        <Table.Cell>{r.roleName ?? r.roleId ?? "—"}</Table.Cell>
                        <Table.Cell>{r.entitlementName ?? r.entitlementId ?? "—"}</Table.Cell>
                        <Table.Cell>
                          {r.justification ? (
                            <span title={r.justification}>
                              {r.justification.length > 60 ? r.justification.slice(0, 60) + "…" : r.justification}
                            </span>
                          ) : (
                            "—"
                          )}
                        </Table.Cell>
                        <Table.Cell>{new Date(r.createdAt).toLocaleDateString()}</Table.Cell>
                        <Table.Cell isActions>
                          <Link to={`/admin/access-requests/${r.id}`}>
                            <Button variant="secondary" size="small">
                              {t("admin.applications.review")}
                            </Button>
                          </Link>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              )}
            </CardSection>
          )}

          {activeTab === "settings" && (
            <CardSection title={t("admin.applications.sections.settings")}>
              <settingsFetcher.Form method="post">
                <input type="hidden" name="intent" value="updateSettings" />
                <Stack gap="md">
                  <Field.Root>
                    <Field.Label>{t("admin.cols.slug")}</Field.Label>
                    <Input value={application.slug} disabled />
                    <Field.Description>{t("admin.applications.settings.syncedReadOnly")}</Field.Description>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>{t("admin.cols.displayName")}</Field.Label>
                    <Input value={application.displayName} disabled />
                    <Field.Description>{t("admin.applications.settings.syncedReadOnly")}</Field.Description>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>{t("admin.cols.accessMode")}</Field.Label>
                    <Select.Root name="accessMode" defaultValue={application.accessMode}>
                      <Select.Trigger aria-label={t("admin.cols.accessMode")}>
                        <Select.Value placeholder={t("admin.applications.settings.accessModePlaceholder")} />
                        <Select.Icon />
                      </Select.Trigger>
                      <Select.Popup>
                        <Select.Item value="open">
                          <Select.ItemText>{t("common.enums.accessMode.open")}</Select.ItemText>
                        </Select.Item>
                        <Select.Item value="request">
                          <Select.ItemText>{t("common.enums.accessMode.request")}</Select.ItemText>
                        </Select.Item>
                        <Select.Item value="invite_only">
                          <Select.ItemText>{t("common.enums.accessMode.invite_only")}</Select.ItemText>
                        </Select.Item>
                      </Select.Popup>
                    </Select.Root>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>{t("admin.cols.enabled")}</Field.Label>
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
                      {t("admin.applications.settings.enabledLabel")}
                    </Checkbox>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>{t("admin.cols.owner")}</Field.Label>
                    <Select.Root name="ownerId" defaultValue={application.ownerId ?? ""}>
                      <Select.Trigger aria-label={t("admin.cols.owner")}>
                        <Select.Value placeholder={t("admin.applications.settings.ownerPlaceholder")} />
                        <Select.Icon />
                      </Select.Trigger>
                      <Select.Popup>
                        {(principals as Principal[]).map((p) => (
                          <Select.Item key={p.id} value={p.id}>
                            <Select.ItemText>{p.displayName}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Popup>
                    </Select.Root>
                  </Field.Root>
                  <Button type="submit" variant="primary" disabled={settingsFetcher.state !== "idle"}>
                    {settingsFetcher.state !== "idle"
                      ? t("admin.applications.settings.saving")
                      : t("admin.applications.settings.save")}
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
        ldapProvisioned={ldapProvisioned}
        onGoToRoles={() => setActiveTab("roles")}
      />

      {/* Create Role Dialog */}
      <Dialog.Root open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>{t("admin.applications.dialog.createRole")}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setRoleDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createRole" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>{t("admin.cols.slug")}</Field.Label>
                  <Input name="slug" placeholder={t("admin.applications.dialog.roleSlugPlaceholder")} required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.displayName")}</Field.Label>
                  <Input name="displayName" placeholder={t("admin.applications.dialog.roleNamePlaceholder")} required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.description")}</Field.Label>
                  <Input name="description" placeholder={t("admin.applications.dialog.descriptionPlaceholder")} />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? t("admin.applications.dialog.creating") : t("admin.applications.dialog.createRole")}
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
            <Dialog.Title>{t("admin.applications.dialog.createEntitlement")}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setEntitlementDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createEntitlement" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>{t("admin.cols.slug")}</Field.Label>
                  <Input name="slug" placeholder={t("admin.applications.dialog.entitlementSlugPlaceholder")} required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.displayName")}</Field.Label>
                  <Input
                    name="displayName"
                    placeholder={t("admin.applications.dialog.entitlementNamePlaceholder")}
                    required
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.description")}</Field.Label>
                  <Input name="description" placeholder={t("admin.applications.dialog.descriptionPlaceholder")} />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting
                    ? t("admin.applications.dialog.creating")
                    : t("admin.applications.dialog.createEntitlement")}
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
            <Dialog.Title>{t("admin.applications.dialog.createResource")}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setResourceDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createResource" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>{t("admin.applications.dialog.resourceType")}</Field.Label>
                  <Input
                    name="resourceType"
                    placeholder={t("admin.applications.dialog.resourceTypePlaceholder")}
                    required
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.displayName")}</Field.Label>
                  <Input
                    name="displayName"
                    placeholder={t("admin.applications.dialog.resourceNamePlaceholder")}
                    required
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.externalId")}</Field.Label>
                  <Input name="externalId" placeholder={t("admin.applications.dialog.externalIdPlaceholder")} />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.cols.path")}</Field.Label>
                  <Input name="path" placeholder={t("admin.applications.dialog.pathPlaceholder")} />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting
                    ? t("admin.applications.dialog.creating")
                    : t("admin.applications.dialog.createResource")}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  )
}

const styles = css.create({
  tabContent: {
    paddingTop: spacing.md,
  },
})
