import { Effect } from "effect"
import type { Route } from "./+types/admin.principals.$id"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import type { Principal, Grant, Role, Entitlement, Application } from "~/lib/governance/types"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { useReactTable, getCoreRowModel, createColumnHelper } from "@tanstack/react-table"
import { html } from "react-strict-dom"
import { Badge, EmptyState, Heading, Stack, Text, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)
  const principalId = params.id

  const [principal, grants, groups, roles, entitlements, principals, applications] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.findById(principalId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        return yield* repo.findActiveForPrincipal(principalId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.listGroupsFor(principalId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listAllRoles()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listAllEntitlements()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.list()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        return yield* repo.list()
      }),
    ),
  ])

  if (!principal) {
    throw new Response("Principal not found", { status: 404 })
  }

  return { principal, grants, groups, roles, entitlements, principals, applications }
}

const grantColumnHelper = createColumnHelper<Grant>()
interface GrantNameResolvers {
  role: (id: string | null) => string
  entitlement: (id: string | null) => string
  principal: (id: string) => string
  application: (grant: Grant) => string
}
const buildGrantColumns = (r: GrantNameResolvers, t: TFunction) => [
  // The grant's owning application (from its role or entitlement — a grant is
  // one or the other). Replaces the old opaque grant-id column.
  grantColumnHelper.display({
    id: "application",
    header: t("admin.cols.application"),
    cell: ({ row }) => r.application(row.original),
  }),
  grantColumnHelper.accessor("roleId", {
    header: t("admin.cols.role"),
    cell: ({ getValue }) => r.role(getValue()),
  }),
  grantColumnHelper.accessor("entitlementId", {
    header: t("admin.cols.entitlement"),
    cell: ({ getValue }) => r.entitlement(getValue()),
  }),
  grantColumnHelper.accessor("resourceId", {
    header: t("admin.cols.resource"),
    cell: ({ getValue }) => getValue() ?? t("admin.cols.all"),
  }),
  grantColumnHelper.accessor("grantedBy", {
    header: t("admin.cols.grantedBy"),
    cell: ({ getValue }) => r.principal(getValue()),
  }),
  grantColumnHelper.accessor("expiresAt", {
    header: t("admin.cols.expires"),
    cell: ({ getValue }) => {
      const v = getValue()
      return v ? new Date(v).toLocaleDateString() : t("admin.cols.never")
    },
  }),
]

const groupColumnHelper = createColumnHelper<Principal>()
const buildGroupColumns = (t: TFunction) => [
  groupColumnHelper.accessor("displayName", { header: t("admin.cols.groupName") }),
  groupColumnHelper.accessor("externalId", {
    header: t("admin.cols.externalId"),
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

export default function AdminPrincipalDetailPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { principal, grants, groups, roles = [], entitlements = [], principals = [], applications = [] } = loaderData

  const grantColumns = useMemo(() => {
    const roleName = new Map((roles as Role[]).map((x) => [x.id, x.displayName]))
    const entName = new Map((entitlements as Entitlement[]).map((x) => [x.id, x.displayName]))
    const principalName = new Map((principals as Principal[]).map((p) => [p.id, p.displayName]))
    // Resolve a grant → its owning application via whichever of role/entitlement
    // is set (both carry applicationId; a grant is role XOR entitlement).
    const roleAppId = new Map((roles as Role[]).map((x) => [x.id, x.applicationId]))
    const entAppId = new Map((entitlements as Entitlement[]).map((x) => [x.id, x.applicationId]))
    const appName = new Map((applications as Application[]).map((a) => [a.id, a.displayName]))
    return buildGrantColumns(
      {
        role: (id) => (id ? (roleName.get(id) ?? id) : "—"),
        entitlement: (id) => (id ? (entName.get(id) ?? id) : "—"),
        principal: (id) => principalName.get(id) ?? id,
        application: (g) => {
          const appId = (g.roleId && roleAppId.get(g.roleId)) || (g.entitlementId && entAppId.get(g.entitlementId))
          return appId ? (appName.get(appId) ?? appId) : "—"
        },
      },
      t,
    )
  }, [roles, entitlements, principals, applications, t])

  const grantsTable = useReactTable({
    data: grants,
    columns: grantColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const groupColumns = useMemo(() => buildGroupColumns(t), [t])

  const groupsTable = useReactTable({
    data: groups,
    columns: groupColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Stack gap="md">
      <html.div>
        <Heading level={2}>{principal.displayName}</Heading>
        <Text color="muted">
          <Badge variant={principal.principalType === "user" ? "default" : "info"}>
            {t(`common.enums.principalType.${principal.principalType}`)}
          </Badge>{" "}
          &middot; {principal.email ?? t("admin.principals.noEmail")} &middot;{" "}
          <Badge variant={principal.enabled ? "success" : "default"}>
            {principal.enabled ? t("admin.cols.enabled") : t("admin.cols.disabled")}
          </Badge>
        </Text>
      </html.div>

      <CardSection title={t("admin.grants.title", { count: grants.length })}>
        {grants.length === 0 ? (
          <EmptyState message={t("admin.principals.noGrants")} />
        ) : (
          <Table.FromTanstack table={grantsTable} />
        )}
      </CardSection>

      <CardSection title={t("admin.principals.groupsTitle", { count: groups.length })}>
        {groups.length === 0 ? (
          <EmptyState message={t("admin.principals.noGroups")} />
        ) : (
          <Table.FromTanstack table={groupsTable} />
        )}
      </CardSection>
    </Stack>
  )
}
