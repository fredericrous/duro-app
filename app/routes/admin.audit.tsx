import { useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { enumLabel } from "~/lib/enum-labels"
import { Effect } from "effect"
import type { Route } from "./+types/admin.audit"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import type { AuditEvent } from "~/lib/governance/types"

type AuditEventWithNames = AuditEvent & {
  actorName: string | null
  applicationName: string | null
  targetName: string | null
}
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
import { Badge, Button, Combobox, EmptyState, Inline, Input, Stack, Table, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

function safeParseMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === null || metadata === undefined) return {}
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>
    } catch {
      return { _raw: metadata }
    }
  }
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    try {
      JSON.stringify(metadata)
      return metadata as Record<string, unknown>
    } catch {
      return { _error: "non-serializable metadata" }
    }
  }
  return {}
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const eventType = url.searchParams.get("eventType") || undefined
  const actorId = url.searchParams.get("actorId") || undefined
  const targetType = url.searchParams.get("targetType") || undefined
  const targetId = url.searchParams.get("targetId") || undefined
  const applicationId = url.searchParams.get("applicationId") || undefined
  const source = url.searchParams.get("source") || undefined
  const page = parseInt(url.searchParams.get("page") || "0", 10)
  const pageSize = 50

  let events: AuditEventWithNames[] = []
  let error: string | undefined

  try {
    events = await runEffect(
      Effect.gen(function* () {
        const svc = yield* AuditService
        const principalRepo = yield* PrincipalRepo
        const appRepo = yield* ApplicationRepo
        const rbac = yield* RbacRepo

        const [raw, principals, apps, roles, entitlements] = [
          yield* svc.query({
            eventType,
            actorId,
            targetType,
            targetId,
            applicationId,
            limit: source ? pageSize * 5 : pageSize,
            offset: source ? 0 : page * pageSize,
          }),
          yield* principalRepo.list(),
          yield* appRepo.list(),
          yield* rbac.listAllRoles(),
          yield* rbac.listAllEntitlements(),
        ]
        const actorMap = new Map(principals.map((p) => [p.id, p.displayName]))
        const appNameById = new Map(apps.map((a) => [a.id, a.displayName]))
        const roleNameById = new Map(roles.map((r) => [r.id, r.displayName]))
        const entNameById = new Map(entitlements.map((en) => [en.id, en.displayName]))

        // Resolve a polymorphic audit target (targetType + targetId) to a name.
        // Directly-nameable entities are looked up by id; grant/access_request
        // rows have a UUID target but carry the meaningful role/entitlement (and
        // recipient) in their metadata, so we describe them from that instead.
        // Everything reuses the already-loaded maps — no extra queries. Types we
        // can't name (user_certificate, api_key, recovery_request, …) keep their id.
        const resolveTarget = (
          type: string | null,
          id: string | null,
          meta: Record<string, unknown>,
        ): string | null => {
          if (!id) return null
          switch (type) {
            case "principal":
              return actorMap.get(id) ?? null
            case "application":
              return appNameById.get(id) ?? null
            case "role":
              return roleNameById.get(id) ?? null
            case "entitlement":
              return entNameById.get(id) ?? null
            case "grant":
            case "access_request": {
              const roleId = typeof meta.roleId === "string" ? meta.roleId : null
              const entId = typeof meta.entitlementId === "string" ? meta.entitlementId : null
              const principalId = typeof meta.principalId === "string" ? meta.principalId : null
              const what = roleId ? roleNameById.get(roleId) : entId ? entNameById.get(entId) : null
              const who = principalId ? actorMap.get(principalId) : null
              if (what && who) return `${what} → ${who}`
              return what ?? who ?? null
            }
            default:
              return null
          }
        }

        // Ensure metadata is always a plain serializable object so
        // react-router's JSON serialization doesn't blow up on weird
        // JSONB values (circular refs, cause objects, etc)
        const sanitized = raw.map((e) => {
          const metadata = safeParseMetadata(e.metadata)
          return {
            ...e,
            metadata,
            actorName: e.actorId ? (actorMap.get(e.actorId) ?? null) : null,
            applicationName: e.applicationId ? (appNameById.get(e.applicationId) ?? null) : null,
            targetName: resolveTarget(e.targetType, e.targetId, metadata),
          }
        })

        if (!source) return sanitized

        return sanitized
          .filter((e) => {
            const meta = (e.metadata ?? {}) as Record<string, unknown>
            return meta.source === source
          })
          .slice(0, pageSize)
      }),
    )
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return { events, page, pageSize, source, error }
}

const columnHelper = createColumnHelper<AuditEventWithNames>()

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.accessor("eventType", {
      header: t("admin.cols.eventType"),
      enableSorting: true,
      cell: ({ getValue }) => <Badge>{enumLabel(t, "eventType", getValue())}</Badge>,
    }),
    columnHelper.accessor("actorId", {
      header: t("admin.cols.actor"),
      cell: ({ row }) => row.original.actorName ?? row.original.actorId ?? "\u2014",
    }),
    columnHelper.accessor("targetType", {
      header: t("admin.cols.targetType"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("targetId", {
      header: t("admin.cols.target"),
      cell: ({ row }) => {
        // Prefer the resolved target name; fall back to the (truncated) id for
        // target types we can't name (grant, invitation, access_request, \u2026).
        const name = row.original.targetName
        if (name) return name
        const v = row.original.targetId
        if (!v) return "\u2014"
        return v.length > 16 ? v.slice(0, 16) + "..." : v
      },
    }),
    columnHelper.accessor("applicationId", {
      header: t("admin.cols.application"),
      cell: ({ row }) => row.original.applicationName ?? "\u2014",
    }),
    columnHelper.accessor("ipAddress", {
      header: t("admin.cols.ipAddress"),
      cell: ({ getValue }) => getValue() ?? "\u2014",
    }),
    columnHelper.accessor("createdAt", {
      header: t("admin.cols.timestamp"),
      enableSorting: true,
      cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
    }),
  ]
}

export default function AdminAuditPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { events, page, pageSize, error } = loaderData as Awaited<ReturnType<typeof loader>>
  const [searchParams, setSearchParams] = useSearchParams()
  const [sorting, setSorting] = useState<SortingState>([])
  const columns = useMemo(() => buildColumns(t), [t])

  const table = useReactTable({
    data: events,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const currentEventType = searchParams.get("eventType") || ""
  const currentActor = searchParams.get("actorId") || ""
  const currentTargetType = searchParams.get("targetType") || ""
  const currentTargetId = searchParams.get("targetId") || ""

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    next.set("page", "0")
    setSearchParams(next)
  }

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("eventType")
    next.delete("actorId")
    next.delete("targetType")
    next.delete("targetId")
    next.delete("applicationId")
    next.set("page", "0")
    setSearchParams(next)
  }

  const goToPage = (newPage: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("page", String(newPage))
    setSearchParams(next)
  }

  // Derive unique values for filter comboboxes from the current page's events
  const uniqueEventTypes = useMemo(() => [...new Set(events.map((e) => e.eventType))].sort(), [events])
  const uniqueActors = useMemo(
    () => [...new Set(events.map((e) => e.actorId).filter((v): v is string => Boolean(v)))].sort(),
    [events],
  )
  const uniqueTargetTypes = useMemo(
    () => [...new Set(events.map((e) => e.targetType).filter((v): v is string => Boolean(v)))].sort(),
    [events],
  )

  const hasActiveFilters =
    Boolean(currentEventType) || Boolean(currentActor) || Boolean(currentTargetType) || Boolean(currentTargetId)

  return (
    <Stack gap="md">
      {error && <Text color="error">{t("admin.audit.loadFailed", { error })}</Text>}
      <CardSection
        title={
          <>
            {t("admin.audit.title")}
            <HelpPopover termKey="glossary.audit" />
          </>
        }
      >
        <html.div style={styles.filterBar}>
          <Inline gap="sm">
            <Combobox.Root
              value={currentEventType}
              onValueChange={(v) => setParam("eventType", v)}
              onInputChange={(v) => setParam("eventType", v)}
            >
              <Combobox.Input placeholder={t("admin.audit.filterPlaceholder")} />
              <Combobox.Popup>
                {uniqueEventTypes.map((et) => (
                  <Combobox.Item key={et} value={et}>
                    {et}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
            <Combobox.Root
              value={currentActor}
              onValueChange={(v) => setParam("actorId", v)}
              onInputChange={(v) => setParam("actorId", v)}
            >
              <Combobox.Input placeholder={t("admin.audit.filterByActor")} />
              <Combobox.Popup>
                {uniqueActors.map((a) => (
                  <Combobox.Item key={a} value={a}>
                    {a}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
            <Combobox.Root
              value={currentTargetType}
              onValueChange={(v) => setParam("targetType", v)}
              onInputChange={(v) => setParam("targetType", v)}
            >
              <Combobox.Input placeholder={t("admin.cols.targetType")} />
              <Combobox.Popup>
                {uniqueTargetTypes.map((tt) => (
                  <Combobox.Item key={tt} value={tt}>
                    {tt}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
            <TargetIdFilter currentValue={currentTargetId} onCommit={(v) => setParam("targetId", v)} />
            {hasActiveFilters && (
              <Button variant="secondary" size="small" onClick={clearFilters}>
                {t("admin.audit.clearFilters")}
              </Button>
            )}
          </Inline>
        </html.div>

        {events.length === 0 ? (
          <EmptyState message={t("admin.empty.audit")} />
        ) : (
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
              {table.getRowModel().rows.map((row) => (
                <Table.Row key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <Table.Cell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}

        {events.length > 0 && (
          <html.div style={styles.pagination}>
            <Inline gap="sm">
              <Button variant="secondary" size="small" disabled={page === 0} onClick={() => goToPage(page - 1)}>
                {t("admin.audit.previous")}
              </Button>
              <Text color="muted">{t("admin.audit.page", { page: page + 1 })}</Text>
              <Button
                variant="secondary"
                size="small"
                disabled={events.length < pageSize}
                onClick={() => goToPage(page + 1)}
              >
                {t("admin.audit.next")}
              </Button>
            </Inline>
          </html.div>
        )}
      </CardSection>
    </Stack>
  )
}

/**
 * Target-id filter is a free-text input — Input's onBlur signature doesn't
 * receive the event, and the design system has no onKeyDown affordance, so we
 * keep a local string and call onCommit when the input loses focus.
 */
function TargetIdFilter({
  currentValue,
  onCommit,
}: {
  currentValue: string
  onCommit: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(currentValue)
  return (
    <Input
      placeholder={t("admin.audit.filterByTarget")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== currentValue) onCommit(draft.trim() || null)
      }}
    />
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
