import { useState } from "react"
import { useNavigate } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.access-requests"
import { runEffect } from "~/lib/runtime.server"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import type { AccessRequest } from "~/lib/governance/types"
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
import { Badge, ScrollArea, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader() {
  const requests = await runEffect(
    Effect.gen(function* () {
      const repo = yield* AccessRequestRepo
      return yield* repo.listAll()
    }),
  )
  return { requests }
}

const columnHelper = createColumnHelper<AccessRequest>()

const columns = [
  columnHelper.accessor("status", {
    header: "Status",
    enableSorting: true,
    cell: ({ getValue }) => {
      const status = getValue()
      const variant =
        status === "pending"
          ? "warning"
          : status === "approved"
            ? "success"
            : status === "rejected"
              ? "error"
              : "default"
      return <Badge variant={variant}>{status}</Badge>
    },
  }),
  columnHelper.accessor("requesterId", {
    header: "Requester",
    enableSorting: true,
  }),
  columnHelper.accessor("applicationId", {
    header: "Application",
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
  columnHelper.accessor("justification", {
    header: "Justification",
    cell: ({ getValue }) => {
      const v = getValue()
      if (!v) return "\u2014"
      return v.length > 60 ? v.slice(0, 60) + "..." : v
    },
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    enableSorting: true,
    cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
  }),
]

export default function AdminAccessRequestsPage({ loaderData }: Route.ComponentProps) {
  const { requests } = loaderData
  const navigate = useNavigate()
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const table = useReactTable({
    data: requests,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <Stack gap="md">
      <CardSection title={`Access Requests (${requests.length})`}>
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
                      onClick={() => navigate(`/admin/access-requests/${row.original.id}`)}
                      style={[styles.clickableRow, styles.displayContents]}
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
  displayContents: {
    display: "contents",
  },
})
