import { useState } from "react"
import { useSearchParams } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.audit"
import { runEffect } from "~/lib/runtime.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import type { AuditEvent } from "~/lib/governance/types"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Badge, Combobox, Inline, ScrollArea, Stack, Table, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const eventType = url.searchParams.get("eventType") || undefined
  const actorId = url.searchParams.get("actorId") || undefined
  const applicationId = url.searchParams.get("applicationId") || undefined
  const source = url.searchParams.get("source") || undefined
  const page = parseInt(url.searchParams.get("page") || "0", 10)
  const pageSize = 50

  const events = await runEffect(
    Effect.gen(function* () {
      const svc = yield* AuditService
      const raw = yield* svc.query({
        eventType,
        actorId,
        applicationId,
        limit: source ? pageSize * 5 : pageSize,
        offset: source ? 0 : page * pageSize,
      })

      if (!source) return raw

      return raw
        .filter((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>
          return meta.source === source
        })
        .slice(0, pageSize)
    }),
  )

  return { events, page, pageSize, source }
}

const columnHelper = createColumnHelper<AuditEvent>()

const columns = [
  columnHelper.accessor("eventType", {
    header: "Event Type",
    enableSorting: true,
    cell: ({ getValue }) => <Badge>{getValue()}</Badge>,
  }),
  columnHelper.accessor("actorId", {
    header: "Actor",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("targetType", {
    header: "Target Type",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("targetId", {
    header: "Target",
    cell: ({ getValue }) => {
      const v = getValue()
      if (!v) return "\u2014"
      return v.length > 16 ? v.slice(0, 16) + "..." : v
    },
  }),
  columnHelper.accessor("applicationId", {
    header: "Application",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("ipAddress", {
    header: "IP Address",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("createdAt", {
    header: "Timestamp",
    enableSorting: true,
    cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
  }),
]

export default function AdminAuditPage({ loaderData }: Route.ComponentProps) {
  const { events, page, pageSize } = loaderData
  const [searchParams, setSearchParams] = useSearchParams()
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data: events,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const currentEventType = searchParams.get("eventType") || ""

  const setEventTypeFilter = (value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set("eventType", value)
    } else {
      next.delete("eventType")
    }
    next.set("page", "0")
    setSearchParams(next)
  }

  const goToPage = (newPage: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("page", String(newPage))
    setSearchParams(next)
  }

  // Derive unique event types for the filter combobox
  const uniqueEventTypes = [...new Set(events.map((e) => e.eventType))].sort()

  return (
    <Stack gap="md">
      <CardSection title="Audit Log">
        <html.div style={styles.filterBar}>
          <Inline gap="sm">
            <Combobox.Root
              value={currentEventType}
              onValueChange={setEventTypeFilter}
              onInputChange={setEventTypeFilter}
            >
              <Combobox.Input placeholder="Filter by event type..." />
              <Combobox.Popup>
                {uniqueEventTypes.map((et) => (
                  <Combobox.Item key={et} value={et}>
                    {et}
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
                    <Table.Row key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <Table.Cell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
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

        <html.div style={styles.pagination}>
          <Inline gap="sm">
            <button disabled={page === 0} onClick={() => goToPage(page - 1)}>
              Previous
            </button>
            <Text color="muted">Page {page + 1}</Text>
            <button disabled={events.length < pageSize} onClick={() => goToPage(page + 1)}>
              Next
            </button>
          </Inline>
        </html.div>
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
  pagination: {
    paddingTop: spacing.sm,
    display: "flex",
    justifyContent: "center",
  },
})
