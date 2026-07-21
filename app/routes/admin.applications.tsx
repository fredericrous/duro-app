import { useMemo, useState } from "react"
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { enumLabel } from "~/lib/enum-labels"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import type { Route } from "./+types/admin.applications"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { ReadinessBadge } from "~/components/ReadinessBadge/ReadinessBadge"
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
      const apps = yield* repo.list()

      // Per-app readiness flags in one pass: does the app have a role/entitlement
      // (something to grant), and an active grant (someone holds access)? Grants
      // reach an app via their role/entitlement, mirroring GrantRepo.findActiveForApp.
      const sql = yield* SqlClient.SqlClient
      const flags = yield* sql<{ id: string; has_target: boolean; has_grant: boolean }>`
        SELECT a.id,
          (EXISTS (SELECT 1 FROM roles r WHERE r.application_id = a.id)
            OR EXISTS (SELECT 1 FROM entitlements e WHERE e.application_id = a.id)) AS has_target,
          EXISTS (
            SELECT 1 FROM grants g
            WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > NOW())
              AND (g.role_id IN (SELECT id FROM roles WHERE application_id = a.id)
                OR g.entitlement_id IN (SELECT id FROM entitlements WHERE application_id = a.id))
          ) AS has_grant
        FROM applications a`
      const flagById = new Map(flags.map((f) => [f.id, f]))

      return apps.map(
        (a): AppRow => ({
          ...a,
          hasTarget: Boolean(flagById.get(a.id)?.has_target),
          hasGrant: Boolean(flagById.get(a.id)?.has_grant),
        }),
      )
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

// Rows carry two extra derived flags (does the app have a role/entitlement,
// and an active grant) so the Readiness column can name its maturity level.
type AppRow = Application & { hasTarget: boolean; hasGrant: boolean }

const columnHelper = createColumnHelper<AppRow>()

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.accessor("displayName", {
      header: t("admin.cols.name"),
      enableSorting: true,
      // Render the name as a real link (focusable, announced as a link, works
      // with middle-click / open-in-new-tab) rather than relying only on the
      // implicit row-click navigation, which keyboard + AT users can't reach.
      cell: ({ row, getValue }) => (
        <Link
          to={`/admin/applications/${row.original.id}`}
          style={{ color: "#6aaffc", fontWeight: 500, textDecoration: "none" }}
          // Row onClick already navigates here; don't double-fire it.
          onClick={(e) => e.stopPropagation()}
        >
          {getValue()}
        </Link>
      ),
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
    columnHelper.display({
      id: "readiness",
      header: t("admin.cols.readiness"),
      cell: ({ row }) => (
        <ReadinessBadge
          signals={{
            hasOwner: !!row.original.ownerId,
            hasDescription: !!(row.original.description && row.original.description.trim()),
            hasTarget: row.original.hasTarget,
            hasGrant: row.original.hasGrant,
          }}
        />
      ),
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
