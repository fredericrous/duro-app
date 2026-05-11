import { useState, useMemo } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
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
import { Badge, Combobox, EmptyState, Inline, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"

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

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.accessor("displayName", {
      header: t("admin.cols.displayName"),
      enableSorting: true,
      enableColumnFilter: true,
    }),
    columnHelper.accessor("principalType", {
      header: t("admin.cols.type"),
      enableSorting: true,
      cell: ({ getValue }) => {
        const type = getValue()
        const variant =
          type === "user" ? "default" : type === "group" ? "info" : type === "service_account" ? "warning" : "default"
        return <Badge variant={variant}>{type}</Badge>
      },
    }),
    columnHelper.accessor("email", {
      header: t("admin.cols.email"),
      enableSorting: true,
      enableColumnFilter: true,
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("enabled", {
      header: t("admin.cols.enabled"),
      enableSorting: true,
      cell: ({ getValue }) => (
        <Badge variant={getValue() ? "success" : "default"}>
          {getValue() ? t("admin.cols.yes") : t("admin.cols.no")}
        </Badge>
      ),
    }),
  ]
}

export default function AdminPrincipalsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { principals } = loaderData
  const navigate = useNavigate()
  const columns = useMemo(() => buildColumns(t), [t])
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

  const sectionTitle = (
    <>
      {t("admin.nav.principals")}
      <HelpPopover termKey="glossary.principals" />
    </>
  )

  if (principals.length === 0) {
    return (
      <Stack gap="md">
        <CardSection title={sectionTitle}>
          <EmptyState message={t("admin.empty.principals")} />
        </CardSection>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <CardSection
        title={
          <>
            {sectionTitle} ({principals.length})
          </>
        }
      >
        <html.div style={styles.filterBar}>
          <Inline gap="sm">
            <Combobox.Root
              onValueChange={(v) => setFilter("displayName", v)}
              onInputChange={(v) => setFilter("displayName", v)}
            >
              <Combobox.Input placeholder={t("admin.principals.filterByName")} />
              <Combobox.Popup>
                {principals.map((p) => (
                  <Combobox.Item key={p.id} value={p.displayName}>
                    {p.displayName}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
            <Combobox.Root
              onValueChange={(v) => setFilter("principalType", v)}
              onInputChange={(v) => setFilter("principalType", v)}
            >
              <Combobox.Input placeholder={t("admin.principals.filterByType")} />
              <Combobox.Popup>
                {uniqueTypes.map((typ) => (
                  <Combobox.Item key={typ} value={typ}>
                    {typ}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
          </Inline>
        </html.div>
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
              const href = `/admin/principals/${row.original.id}`
              return (
                <Table.Row key={row.id} onClick={() => navigate(href)} aria-label={row.original.displayName}>
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
})
