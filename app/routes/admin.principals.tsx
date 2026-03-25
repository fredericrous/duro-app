import { useState } from "react"
import { useNavigate } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.principals"
import { runEffect } from "~/lib/runtime.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import type { Principal } from "~/lib/governance/types"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { Badge, Combobox, Inline, ScrollArea, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { useMemo } from "react"

export async function loader() {
  const principals = await runEffect(
    Effect.gen(function* () {
      const repo = yield* PrincipalRepo
      return yield* repo.list()
    }),
  )
  return { principals }
}

const columnHelper = createColumnHelper<Principal>()

const columns = [
  columnHelper.accessor("displayName", {
    header: "Display Name",
    enableSorting: true,
    enableColumnFilter: true,
  }),
  columnHelper.accessor("principalType", {
    header: "Type",
    enableSorting: true,
    cell: ({ getValue }) => {
      const type = getValue()
      const variant =
        type === "user" ? "default" : type === "group" ? "info" : type === "service_account" ? "warning" : "default"
      return <Badge variant={variant}>{type}</Badge>
    },
  }),
  columnHelper.accessor("email", {
    header: "Email",
    enableSorting: true,
    enableColumnFilter: true,
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("enabled", {
    header: "Enabled",
    enableSorting: true,
    cell: ({ getValue }) => <Badge variant={getValue() ? "success" : "default"}>{getValue() ? "Yes" : "No"}</Badge>,
  }),
]

export default function AdminPrincipalsPage({ loaderData }: Route.ComponentProps) {
  const { principals } = loaderData
  const navigate = useNavigate()
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const table = useReactTable({
    data: principals,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const uniqueTypes = useMemo(() => [...new Set(principals.map((p) => p.principalType))].sort(), [principals])

  const setFilter = (columnId: string, value: string | null) => {
    table.getColumn(columnId)?.setFilterValue(value || undefined)
  }

  return (
    <Stack gap="md">
      <CardSection title={`Principals (${principals.length})`}>
        <html.div style={styles.filterBar}>
          <Inline gap="sm">
            <Combobox.Root
              onValueChange={(v) => setFilter("displayName", v)}
              onInputChange={(v) => setFilter("displayName", v)}
            >
              <Combobox.Input placeholder="Filter by name..." />
              <Combobox.Popup>
                {principals.map((p) => (
                  <Combobox.Item key={p.id} value={p.displayName}>
                    {p.displayName}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>No results</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
            <Combobox.Root
              onValueChange={(v) => setFilter("principalType", v)}
              onInputChange={(v) => setFilter("principalType", v)}
            >
              <Combobox.Input placeholder="Filter by type..." />
              <Combobox.Popup>
                {uniqueTypes.map((t) => (
                  <Combobox.Item key={t} value={t}>
                    {t}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>No results</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
          </Inline>
        </html.div>
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
                                <html.span style={styles.sortHeader} onClick={header.column.getToggleSortingHandler()}>
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
                    <html.div
                      key={row.id}
                      onClick={() => navigate(`/admin/principals/${row.original.id}`)}
                      style={styles.clickableRow}
                    >
                      <Table.Row>
                        {row.getVisibleCells().map((cell) => (
                          <Table.Cell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    </html.div>
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

const styles = css.create({
  filterBar: {
    paddingBottom: spacing.sm,
  },
  sortHeader: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    userSelect: "none",
  },
  clickableRow: {
    cursor: "pointer",
  },
})
