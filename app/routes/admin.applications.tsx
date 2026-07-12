import { useMemo, useState } from "react"
import { useFetcher, useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { enumLabel } from "~/lib/enum-labels"
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
import { Alert, Badge, Button, EmptyState, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

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

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.accessor("displayName", {
      header: t("admin.cols.name"),
      enableSorting: true,
    }),
    columnHelper.accessor("slug", {
      header: t("admin.cols.slug"),
      enableSorting: true,
    }),
    columnHelper.accessor("accessMode", {
      header: t("admin.cols.accessMode"),
      enableSorting: true,
      cell: ({ getValue }) => {
        const mode = getValue()
        const variant = mode === "open" ? "success" : mode === "request" ? "warning" : "default"
        return <Badge variant={variant}>{enumLabel(t, "accessMode", mode)}</Badge>
      },
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
    columnHelper.accessor("ownerId", {
      header: t("admin.cols.owner"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
  ]
}

export default function AdminApplicationsPage({ loaderData }: Route.ComponentProps) {
  "use no memo"
  const { t } = useTranslation()
  const { applications } = loaderData
  const navigate = useNavigate()
  const fetcher = useFetcher<typeof action>()
  const columns = useMemo(() => buildColumns(t), [t])
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

  const syncForm = (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="syncFromCluster" />
      <Button type="submit" variant="primary" size="small" disabled={isSyncing}>
        {isSyncing ? t("admin.applications.syncing") : t("admin.applications.syncFromCluster")}
      </Button>
    </fetcher.Form>
  )

  const appsHelpTitle = (
    <>
      {t("admin.nav.applications")}
      <HelpPopover termKey="glossary.applications" />
    </>
  )

  if (applications.length === 0) {
    return (
      <Stack gap="md">
        <CardSection title={appsHelpTitle} action={syncForm}>
          {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
          <EmptyState message={t("admin.empty.applications")} />
        </CardSection>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <CardSection
        title={
          <>
            {appsHelpTitle} ({applications.length})
          </>
        }
        action={syncForm}
      >
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}

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
              const href = `/admin/applications/${row.original.id}`
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
  sortHeader: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    userSelect: "none",
  },
})
