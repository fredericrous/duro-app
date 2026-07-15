import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { enumLabel } from "~/lib/enum-labels"
import { Effect } from "effect"
import type { Route } from "./+types/admin.access-requests"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { AccessRequestRepo, type AccessRequestEnriched } from "~/lib/governance/AccessRequestRepo.server"
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
import { Badge, EmptyState, Stack, Table, Tooltip } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const requests = await runEffect(
    Effect.gen(function* () {
      const repo = yield* AccessRequestRepo
      return yield* repo.listAllEnriched()
    }),
  )
  return { requests }
}

const columnHelper = createColumnHelper<AccessRequestEnriched>()

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
        return <Badge variant={variant}>{enumLabel(t, "requestStatus", status)}</Badge>
      },
    }),
    columnHelper.accessor((row) => row.requesterName ?? row.requesterId, {
      id: "requester",
      header: t("admin.cols.requester"),
      enableSorting: true,
    }),
    columnHelper.accessor((row) => row.applicationName || row.applicationId, {
      id: "application",
      header: t("admin.cols.application"),
      enableSorting: true,
    }),
    columnHelper.accessor((row) => row.roleName ?? row.roleId ?? null, {
      id: "role",
      header: t("admin.cols.role"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor((row) => row.entitlementName ?? row.entitlementId ?? null, {
      id: "entitlement",
      header: t("admin.cols.entitlement"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("justification", {
      header: t("admin.cols.justification"),
      cell: ({ getValue }) => {
        const v = getValue()
        if (!v) return "\u2014"
        if (v.length <= 60) return v
        // Truncate visually but keep the full text reachable on hover/focus.
        // The native title attribute is the screen-reader-friendly fallback;
        // Tooltip layers a styled popover for sighted users.
        const truncated = v.slice(0, 60) + "\u2026"
        return (
          <Tooltip.Root content={v} placement="top">
            <Tooltip.Trigger>
              <html.span style={styles.justificationTrigger}>{truncated}</html.span>
            </Tooltip.Trigger>
          </Tooltip.Root>
        )
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
        <Table.Root
          sortChip={
            <Table.SortChip
              options={table
                .getAllColumns()
                .filter((c) => c.getCanSort())
                .map((c) => ({ id: c.id, label: String(c.columnDef.header ?? c.id) }))}
              value={sorting[0] ? { id: sorting[0].id, desc: sorting[0].desc } : null}
              onChange={(next) => setSorting(next ? [{ id: next.id, desc: next.desc }] : [])}
            />
          }
          pagination={<Table.Pagination table={table} />}
        >
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
                <Table.Row
                  key={row.id}
                  onClick={() => navigate(href)}
                  aria-label={`${row.original.requesterName ?? row.original.requesterId} → ${row.original.applicationName || row.original.applicationId}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <Table.Cell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Cell>
                  ))}
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table.Root>
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
  justificationTrigger: {
    cursor: "help",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: 2,
  },
})
