import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.grants"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import type { Grant } from "~/lib/governance/types"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Badge, Button, ScrollArea, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

type GrantWithNames = Grant & {
  principalName: string
}

export async function loader() {
  const data = await runEffect(
    Effect.gen(function* () {
      const principalRepo = yield* PrincipalRepo
      const principals = yield* principalRepo.list()
      const principalMap = new Map(principals.map((p) => [p.id, p.displayName]))

      // Collect active grants for all principals
      const allGrants: GrantWithNames[] = []
      for (const principal of principals) {
        const grantRepo = yield* GrantRepo
        const grants = yield* grantRepo.findActiveForPrincipal(principal.id)
        for (const grant of grants) {
          allGrants.push({
            ...grant,
            principalName: principalMap.get(grant.principalId) ?? grant.principalId,
          })
        }
      }

      return allGrants
    }),
  )

  return { grants: data }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "revoke") {
    const grantId = formData.get("grantId") as string
    const auth = await getAuth(request)
    const revokedBy = auth.user ?? "system"

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        return yield* repo.revoke(grantId, revokedBy)
      }),
    )
    return { success: true }
  }

  return { error: "Unknown intent" }
}

const columnHelper = createColumnHelper<GrantWithNames>()

function buildColumns() {
  return [
    columnHelper.accessor("principalName", {
      header: "Principal",
      enableSorting: true,
    }),
    columnHelper.accessor("roleId", {
      header: "Role",
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("entitlementId", {
      header: "Entitlement",
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("resourceId", {
      header: "Resource",
      cell: ({ getValue }) => getValue() ?? "All",
    }),
    columnHelper.accessor("grantedBy", {
      header: "Granted By",
      enableSorting: true,
    }),
    columnHelper.accessor("expiresAt", {
      header: "Expires",
      enableSorting: true,
      cell: ({ getValue }) => {
        const v = getValue()
        return v ? new Date(v).toLocaleDateString() : "Never"
      },
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: () => null, // Rendered via RevokeCell component
    }),
  ]
}

export default function AdminGrantsPage({ loaderData }: Route.ComponentProps) {
  const { grants } = loaderData
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const columns = buildColumns()

  const table = useReactTable({
    data: grants,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <Stack gap="md">
      <CardSection title={`Active Grants (${grants.length})`}>
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <ScrollArea.Content>
              <Table.Root>
                <Table.Header>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <Table.Row key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <Table.HeaderCell key={header.id}>
                          {header.isPlaceholder ? null : (
                            <>
                              {header.column.getCanSort() ? (
                                <html.span
                                  style={styles.sortHeader}
                                  onClick={header.column.getToggleSortingHandler()}
                                >
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                  <Table.SortIndicator column={header.column} />
                                </html.span>
                              ) : (
                                flexRender(header.column.columnDef.header, header.getContext())
                              )}
                            </>
                          )}
                        </Table.HeaderCell>
                      ))}
                    </Table.Row>
                  ))}
                </Table.Header>
                <Table.Body>
                  {table.getRowModel().rows.map((row) => (
                    <Table.Row key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <Table.Cell key={cell.id}>
                          {cell.column.id === "actions" ? (
                            <RevokeCell grantId={row.original.id} />
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </Table.Cell>
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
        <Table.Pagination table={table} />
      </CardSection>
    </Stack>
  )
}

function RevokeCell({ grantId }: { grantId: string }) {
  const fetcher = useFetcher()
  const isRevoking = fetcher.state !== "idle"

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="revoke" />
      <input type="hidden" name="grantId" value={grantId} />
      <Button type="submit" variant="danger" size="small" disabled={isRevoking}>
        {isRevoking ? "Revoking..." : "Revoke"}
      </Button>
    </fetcher.Form>
  )
}

const styles = css.create({
  sortHeader: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    userSelect: "none",
  },
})
