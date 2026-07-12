import { Effect } from "effect"
import type { Route } from "./+types/admin.principals.$id"
import { runEffect } from "~/lib/runtime.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import type { Principal, Grant, Role, Entitlement } from "~/lib/governance/types"
import { useMemo } from "react"
import { useReactTable, getCoreRowModel, createColumnHelper } from "@tanstack/react-table"
import { html } from "react-strict-dom"
import { Badge, EmptyState, Heading, Stack, Text, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader({ params }: Route.LoaderArgs) {
  const principalId = params.id

  const [principal, grants, groups, roles, entitlements, principals] = await Promise.all([
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
  ])

  if (!principal) {
    throw new Response("Principal not found", { status: 404 })
  }

  return { principal, grants, groups, roles, entitlements, principals }
}

const grantColumnHelper = createColumnHelper<Grant>()
interface GrantNameResolvers {
  role: (id: string | null) => string
  entitlement: (id: string | null) => string
  principal: (id: string) => string
}
const buildGrantColumns = (r: GrantNameResolvers) => [
  grantColumnHelper.accessor("id", {
    header: "Grant ID",
    cell: ({ getValue }) => getValue().slice(0, 8) + "...",
  }),
  grantColumnHelper.accessor("roleId", {
    header: "Role",
    cell: ({ getValue }) => r.role(getValue()),
  }),
  grantColumnHelper.accessor("entitlementId", {
    header: "Entitlement",
    cell: ({ getValue }) => r.entitlement(getValue()),
  }),
  grantColumnHelper.accessor("resourceId", {
    header: "Resource",
    cell: ({ getValue }) => getValue() ?? "All",
  }),
  grantColumnHelper.accessor("grantedBy", {
    header: "Granted By",
    cell: ({ getValue }) => r.principal(getValue()),
  }),
  grantColumnHelper.accessor("expiresAt", {
    header: "Expires",
    cell: ({ getValue }) => {
      const v = getValue()
      return v ? new Date(v).toLocaleDateString() : "Never"
    },
  }),
]

const groupColumnHelper = createColumnHelper<Principal>()
const groupColumns = [
  groupColumnHelper.accessor("displayName", { header: "Group Name" }),
  groupColumnHelper.accessor("externalId", {
    header: "External ID",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

export default function AdminPrincipalDetailPage({ loaderData }: Route.ComponentProps) {
  const { principal, grants, groups, roles = [], entitlements = [], principals = [] } = loaderData

  const grantColumns = useMemo(() => {
    const roleName = new Map((roles as Role[]).map((x) => [x.id, x.displayName]))
    const entName = new Map((entitlements as Entitlement[]).map((x) => [x.id, x.displayName]))
    const principalName = new Map((principals as Principal[]).map((p) => [p.id, p.displayName]))
    return buildGrantColumns({
      role: (id) => (id ? (roleName.get(id) ?? id) : "—"),
      entitlement: (id) => (id ? (entName.get(id) ?? id) : "—"),
      principal: (id) => principalName.get(id) ?? id,
    })
  }, [roles, entitlements, principals])

  const grantsTable = useReactTable({
    data: grants,
    columns: grantColumns,
    getCoreRowModel: getCoreRowModel(),
  })

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
          <Badge variant={principal.principalType === "user" ? "default" : "info"}>{principal.principalType}</Badge>{" "}
          &middot; {principal.email ?? "No email"} &middot;{" "}
          <Badge variant={principal.enabled ? "success" : "default"}>
            {principal.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </Text>
      </html.div>

      <CardSection title={`Active Grants (${grants.length})`}>
        {grants.length === 0 ? <EmptyState message="No active grants." /> : <Table.FromTanstack table={grantsTable} />}
      </CardSection>

      <CardSection title={`Groups (${groups.length})`}>
        {groups.length === 0 ? (
          <EmptyState message="Not a member of any groups." />
        ) : (
          <Table.FromTanstack table={groupsTable} />
        )}
      </CardSection>
    </Stack>
  )
}
