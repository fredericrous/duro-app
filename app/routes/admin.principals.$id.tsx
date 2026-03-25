import { Effect } from "effect"
import type { Route } from "./+types/admin.principals.$id"
import { runEffect } from "~/lib/runtime.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import type { Principal, Grant } from "~/lib/governance/types"
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table"
import { html } from "react-strict-dom"
import { Badge, Heading, ScrollArea, Stack, Text, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader({ params }: Route.LoaderArgs) {
  const principalId = params.id

  const [principal, grants, groups] = await Promise.all([
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
  ])

  if (!principal) {
    throw new Response("Principal not found", { status: 404 })
  }

  return { principal, grants, groups }
}

const grantColumnHelper = createColumnHelper<Grant>()
const grantColumns = [
  grantColumnHelper.accessor("id", {
    header: "Grant ID",
    cell: ({ getValue }) => getValue().slice(0, 8) + "...",
  }),
  grantColumnHelper.accessor("roleId", {
    header: "Role",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  grantColumnHelper.accessor("entitlementId", {
    header: "Entitlement",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  grantColumnHelper.accessor("resourceId", {
    header: "Resource",
    cell: ({ getValue }) => getValue() ?? "All",
  }),
  grantColumnHelper.accessor("grantedBy", {
    header: "Granted By",
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
  const { principal, grants, groups } = loaderData

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
        {grants.length === 0 ? <Text color="muted">No active grants.</Text> : <DataTable table={grantsTable} />}
      </CardSection>

      <CardSection title={`Groups (${groups.length})`}>
        {groups.length === 0 ? (
          <Text color="muted">Not a member of any groups.</Text>
        ) : (
          <DataTable table={groupsTable} />
        )}
      </CardSection>
    </Stack>
  )
}

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
