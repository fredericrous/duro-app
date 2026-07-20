import { useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/admin.grants"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { deactivateGrant } from "~/lib/workflows/grant-activation.server"
import type { Grant } from "~/lib/governance/types"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { Button, ConfirmDialog, EmptyState, LinkButton, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

type GrantWithNames = Grant & {
  principalName: string
  applicationId: string | null
  applicationName: string
  roleName: string
  entitlementName: string | null
  grantedByName: string
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const data = await runEffect(
    Effect.gen(function* () {
      const principalRepo = yield* PrincipalRepo
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo

      const principals = yield* principalRepo.list()
      const principalMap = new Map(principals.map((p) => [p.id, p.displayName]))

      // Resolve roles + entitlements to display names AND their owning
      // application, so each grant shows "which app / which role-or-entitlement"
      // instead of a raw UUID. A grant is role XOR entitlement; both are scoped
      // to one application, so the app comes from whichever side is set.
      const apps = yield* appRepo.list()
      const appNameById = new Map(apps.map((a) => [a.id, a.displayName]))
      const roles = yield* rbac.listAllRoles()
      const roleInfoById = new Map(roles.map((r) => [r.id, { name: r.displayName, appId: r.applicationId }]))
      const entitlements = yield* rbac.listAllEntitlements()
      const entInfoById = new Map(entitlements.map((e) => [e.id, { name: e.displayName, appId: e.applicationId }]))

      // Collect active grants for all principals
      const allGrants: GrantWithNames[] = []
      for (const principal of principals) {
        const grantRepo = yield* GrantRepo
        const grants = yield* grantRepo.findActiveForPrincipal(principal.id)
        for (const grant of grants) {
          const roleInfo = grant.roleId ? roleInfoById.get(grant.roleId) : undefined
          const entInfo = grant.entitlementId ? entInfoById.get(grant.entitlementId) : undefined
          const appId = roleInfo?.appId ?? entInfo?.appId ?? null
          allGrants.push({
            ...grant,
            principalName: principalMap.get(grant.principalId) ?? grant.principalId,
            applicationId: appId,
            applicationName: appId ? (appNameById.get(appId) ?? appId) : "—",
            roleName: grant.roleId === null ? "—" : (roleInfo?.name ?? grant.roleId),
            entitlementName: grant.entitlementId === null ? null : (entInfo?.name ?? grant.entitlementId),
            grantedByName: principalMap.get(grant.grantedBy) ?? grant.grantedBy,
          })
        }
      }

      return { grants: allGrants }
    }),
  )

  return data
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "revoke") {
    const grantId = formData.get("grantId") as string

    // Resolve the session username to a principal id (FK constraint on
    // grants.revoked_by → principals.id). Same pattern as createGrant.
    const auth = await getAuth(request)
    const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
    if (!decision.allow || !auth.sub) {
      throw new Response("Forbidden", { status: 403 })
    }
    const principal = await runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.findByExternalId(auth.sub!)
      }),
    )
    if (!principal) {
      throw new Response("Principal not found for current session", { status: 403 })
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const audit = yield* AuditService
        yield* repo.revoke(grantId, principal.id)
        yield* audit
          .emit({
            eventType: "grant.revoked",
            actorId: principal.id,
            targetType: "grant",
            targetId: grantId,
          })
          .pipe(Effect.catchAll(() => Effect.void))
        yield* deactivateGrant(grantId)
      }),
    )
    return { success: true }
  }

  return { error: "Unknown intent" }
}

const columnHelper = createColumnHelper<GrantWithNames>()

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.accessor("principalName", {
      header: t("admin.cols.principal"),
      enableSorting: true,
    }),
    columnHelper.accessor("applicationName", {
      header: t("admin.cols.application"),
      enableSorting: true,
    }),
    columnHelper.accessor("roleName", {
      header: t("admin.cols.role"),
      enableSorting: true,
    }),
    columnHelper.accessor("entitlementName", {
      header: t("admin.cols.entitlement"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("resourceId", {
      header: t("admin.cols.resource"),
      cell: ({ getValue }) => getValue() ?? t("admin.cols.all"),
    }),
    columnHelper.accessor("grantedByName", {
      header: t("admin.cols.grantedBy"),
      enableSorting: true,
    }),
    columnHelper.accessor("expiresAt", {
      header: t("admin.cols.expires"),
      enableSorting: true,
      cell: ({ getValue }) => {
        const v = getValue()
        return v ? new Date(v).toLocaleDateString() : t("admin.cols.never")
      },
    }),
    columnHelper.display({
      id: "actions",
      header: t("admin.cols.actions"),
      cell: () => null, // Rendered via RevokeCell component
    }),
  ]
}

export default function AdminGrantsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { grants } = loaderData
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const columns = useMemo(() => buildColumns(t), [t])

  const table = useReactTable({
    data: grants,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const createGrantAction = (
    <LinkButton href="/admin/grants/new" variant="primary" size="small">
      {t("admin.grants.createGrant")}
    </LinkButton>
  )

  const grantsHelpTitle = (
    <>
      {t("admin.nav.grants")}
      <HelpPopover termKey="glossary.grants" />
    </>
  )

  if (grants.length === 0) {
    return (
      <Stack gap="md">
        <CardSection title={grantsHelpTitle}>
          <EmptyState message={t("admin.empty.grants")} action={createGrantAction} />
        </CardSection>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <CardSection
        title={
          <>
            {grantsHelpTitle} ({grants.length})
          </>
        }
        action={createGrantAction}
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
                  <Table.HeaderCell
                    key={header.id}
                    label={String(header.column.columnDef.header ?? "")}
                    // Actions column holds buttons — give it its natural width
                    // so it isn't squeezed to the column floor when the table
                    // scrolls horizontally.
                    width={header.column.id === "actions" ? "max-content" : undefined}
                  >
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
            {table.getRowModel().rows.map((row) => (
              <Table.Row key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const isActions = cell.column.id === "actions"
                  return (
                    <Table.Cell key={cell.id} isActions={isActions}>
                      {isActions ? (
                        <RevokeCell grantId={row.original.id} />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </Table.Cell>
                  )
                })}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </CardSection>
    </Stack>
  )
}

function RevokeCell({ grantId }: { grantId: string }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isRevoking = fetcher.state !== "idle"
  useFetcherToast(fetcher, { successMessage: t("admin.grants.revoked") })

  return (
    <>
      <Button type="button" variant="danger" size="small" disabled={isRevoking} onClick={() => setConfirmOpen(true)}>
        {isRevoking ? t("admin.grants.revoking") : t("admin.grants.revoke")}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("admin.grants.confirmRevokeTitle")}
        confirmSlot={() => (
          <fetcher.Form method="post" onSubmit={() => setConfirmOpen(false)}>
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="grantId" value={grantId} />
            <Button type="submit" variant="danger">
              {t("admin.grants.revoke")}
            </Button>
          </fetcher.Form>
        )}
      >
        {t("admin.grants.confirmRevokeBody")}
      </ConfirmDialog>
    </>
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
