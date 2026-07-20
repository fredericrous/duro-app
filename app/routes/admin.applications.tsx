import { useMemo, useState } from "react"
import { useFetcher, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { enumLabel } from "~/lib/enum-labels"
import { Effect } from "effect"
import type { Route } from "./+types/admin.applications"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { parseAdminApplicationsMutation, handleAdminApplicationsMutation } from "~/lib/mutations/admin-applications"
import type { Application } from "~/lib/governance/types"
import { createColumnHelper, type SortingState } from "@tanstack/react-table"
import { Alert, Badge, Button, EmptyState, Stack, VirtualTable } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const applications = await runEffect(
    Effect.gen(function* () {
      const repo = yield* ApplicationRepo
      return yield* repo.list()
    }),
  )
  return { applications }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdminAction(request)

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
      cell: ({ getValue }) => getValue() ?? "—",
    }),
  ]
}

export default function AdminApplicationsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { applications } = loaderData
  const navigate = useNavigate()
  const fetcher = useFetcher<typeof action>()
  const columns = useMemo(() => buildColumns(t), [t])
  const [sorting, setSorting] = useState<SortingState>([])
  const [params, setParams] = useSearchParams()

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

        {/* One scrolling list (VirtualTable) instead of pagination: it renders
            every app while the list is small and windows automatically past 150
            rows, syncing the visible page to ?page=. Click a header to sort. */}
        <VirtualTable
          data={applications}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          getRowId={(a) => a.id}
          onRowClick={(a) => navigate(`/admin/applications/${a.id}`)}
          rowLabel={(a) => a.displayName}
          initialPage={Number(params.get("page")) || 1}
          onVisiblePageChange={({ page }) =>
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                if (page > 1) next.set("page", String(page))
                else next.delete("page")
                return next
              },
              { replace: true, preventScrollReset: true },
            )
          }
          rangeLabel={({ from, to, total }) => t("admin.applications.range", { from, to, total })}
          emptyLabel={t("admin.empty.applications")}
        />
      </CardSection>
    </Stack>
  )
}
