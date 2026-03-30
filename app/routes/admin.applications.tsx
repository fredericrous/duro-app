import { useState } from "react"
import { useFetcher, useNavigate } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.applications"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { parseAdminApplicationsMutation, handleAdminApplicationsMutation } from "~/lib/mutations/admin-applications"
import type { Application } from "~/lib/governance/types"
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
import { Alert, Badge, Button, ScrollArea, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader() {
  const applications = await runEffect(
    Effect.gen(function* () {
      const repo = yield* ApplicationRepo
      return yield* repo.list()
    }),
  )
  return { applications }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminApplicationsMutation(formData as any)
  if ("error" in parsed) return parsed

  return await runEffect(handleAdminApplicationsMutation(parsed))
}

const columnHelper = createColumnHelper<Application>()

const columns = [
  columnHelper.accessor("displayName", {
    header: "Name",
    enableSorting: true,
  }),
  columnHelper.accessor("slug", {
    header: "Slug",
    enableSorting: true,
  }),
  columnHelper.accessor("accessMode", {
    header: "Access Mode",
    enableSorting: true,
    cell: ({ getValue }) => {
      const mode = getValue()
      const variant = mode === "open" ? "success" : mode === "request" ? "warning" : "default"
      return <Badge variant={variant}>{mode}</Badge>
    },
  }),
  columnHelper.accessor("enabled", {
    header: "Enabled",
    enableSorting: true,
    cell: ({ getValue }) => <Badge variant={getValue() ? "success" : "default"}>{getValue() ? "Yes" : "No"}</Badge>,
  }),
  columnHelper.accessor("ownerId", {
    header: "Owner",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

export default function AdminApplicationsPage({ loaderData }: Route.ComponentProps) {
  "use no memo"
  const { applications } = loaderData
  const navigate = useNavigate()
  const fetcher = useFetcher<typeof action>()
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const table = useReactTable({
    data: applications,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const isSyncing = fetcher.state !== "idle"
  const actionData = fetcher.data

  return (
    <Stack gap="md">
      <CardSection
        title={`Applications (${applications.length})`}
        action={
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="syncFromCluster" />
            <Button type="submit" variant="primary" size="small" disabled={isSyncing}>
              {isSyncing ? "Syncing..." : "Sync from cluster"}
            </Button>
          </fetcher.Form>
        }
      >
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}

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
                      onClick={() => navigate(`/admin/applications/${row.original.id}`)}
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
