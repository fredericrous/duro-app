import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
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
import { Badge, EmptyState, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

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

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.accessor("status", {
      header: t("admin.cols.status"),
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
      header: t("admin.cols.requester"),
      enableSorting: true,
    }),
    columnHelper.accessor("applicationId", {
      header: t("admin.cols.application"),
      enableSorting: true,
    }),
    columnHelper.accessor("roleId", {
      header: t("admin.cols.role"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("entitlementId", {
      header: t("admin.cols.entitlement"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("justification", {
      header: t("admin.cols.justification"),
      cell: ({ getValue }) => {
        const v = getValue()
        if (!v) return "\u2014"
        return v.length > 60 ? v.slice(0, 60) + "..." : v
      },
    }),
    columnHelper.accessor("createdAt", {
      header: t("admin.cols.created"),
      enableSorting: true,
      cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
    }),
  ]
}

export default function AdminAccessRequestsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { requests } = loaderData
  const navigate = useNavigate()
  const columns = useMemo(() => buildColumns(t), [t])
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

  const sectionTitle = (
    <>
      {t("admin.nav.accessRequests")}
      <HelpPopover termKey="glossary.accessRequests" />
    </>
  )

  if (requests.length === 0) {
    return (
      <Stack gap="md">
        <CardSection title={sectionTitle}>
          <EmptyState message={t("admin.empty.accessRequests")} />
        </CardSection>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <CardSection
        title={
          <>
            {sectionTitle} ({requests.length})
          </>
        }
      >
        <Table.Container>
          <Table.SortChip
            options={table
              .getAllColumns()
              .filter((c) => c.getCanSort())
              .map((c) => ({ id: c.id, label: String(c.columnDef.header ?? c.id) }))}
            value={sorting[0] ? { id: sorting[0].id, desc: sorting[0].desc } : null}
            onChange={(next) => setSorting(next ? [{ id: next.id, desc: next.desc }] : [])}
          />
          <Table.Root>
            <Table.Header>
              {table.getHeaderGroups().map((headerGroup) => (
                <Table.Row key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <Table.HeaderCell key={header.id} label={String(header.column.columnDef.header ?? "")}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <html.span style={styles.sortHeader} onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <Table.SortIndicator column={header.column} />
                        </html.span>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </Table.HeaderCell>
                  ))}
                </Table.Row>
              ))}
            </Table.Header>
            <Table.Body>
              {table.getRowModel().rows.map((row) => {
                const href = `/admin/access-requests/${row.original.id}`
                return (
                  <html.div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${row.original.requesterId} → ${row.original.applicationId}`}
                    onClick={() => navigate(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        navigate(href)
                      }
                    }}
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
                )
              })}
            </Table.Body>
          </Table.Root>
          <Table.Pagination table={table} />
        </Table.Container>
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
