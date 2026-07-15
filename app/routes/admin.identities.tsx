import { useState, useEffect, useMemo, useCallback } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.identities"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { config } from "~/lib/config.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertificateRepo, type UserCertificate } from "~/lib/services/CertificateRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { handleAdminUsersMutation, parseAdminUsersMutation } from "~/lib/mutations/admin-users"
import {
  buildIdentities,
  certBatchRevokeToast,
  buildBatchForm,
  type Identity,
  type IdentityType,
} from "~/lib/identities"
import { enumLabel } from "~/lib/enum-labels"
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table"

import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import {
  ActionBar,
  Badge,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  EmptyState,
  Inline,
  Input,
  LinkButton,
  Stack,
  Table,
  Text,
  Toggle,
  ToggleGroup,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { useAdminSidePanel } from "./admin"
import type { RevokeTarget } from "~/components/admin/UserColumns"
import { ActionCell } from "~/components/admin/ActionCell"
import { CertPanelContent } from "~/components/admin/CertPanelContent"
import { RevokedUserRow } from "~/components/admin/RevokedUserRow"

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const [users, principals, revocations, certsByUser] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getUsers
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.list()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findRevocations()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        const certRepo = yield* CertificateRepo
        const allUsers = yield* um.getUsers
        const usernames = allUsers.map((u: { id: string }) => u.id)
        return yield* certRepo.listAllByUsernames(usernames).pipe(Effect.catchAll(() => Effect.succeed({})))
      }),
    ),
  ])

  const systemUserIds = [...new Set(users.filter((u: any) => config.isSystemUser(u.id)).map((u: any) => u.id))]
  return { users, principals, revocations, systemUserIds, certsByUser }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdminAction(request)

  const formData = await request.formData()
  const parsed = parseAdminUsersMutation(formData as any)
  if ("error" in parsed) return parsed

  return await runEffect(handleAdminUsersMutation(parsed))
}

const styles = css.create({
  bar: {
    paddingBottom: spacing.sm,
  },
  filterRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
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
  nameCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  secondary: {
    color: "var(--textMuted, #888)",
    fontSize: 12,
  },
})

const typeVariant: Record<IdentityType, "default" | "info" | "warning"> = {
  user: "default",
  group: "info",
  service_account: "warning",
  device: "default",
}

const columnHelper = createColumnHelper<Identity>()

function buildIdentityColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.display({
      id: "select",
      size: 40,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label={t("admin.users.selectAll")}
        />
      ),
      cell: ({ row }) => {
        if (!row.getCanSelect()) return null
        return (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label={row.original.uid ?? row.original.displayName}
          />
        )
      },
    }),
    columnHelper.accessor("displayName", {
      header: t("admin.cols.displayName"),
      size: 240,
      enableColumnFilter: true,
      enableSorting: true,
      cell: ({ row }) => {
        const { displayName, uid, type, provisioned } = row.original
        return (
          <html.div style={styles.nameCell}>
            <html.span>{displayName}</html.span>
            {type === "user" && uid && <html.span style={styles.secondary}>{uid}</html.span>}
            {type === "user" && !provisioned && (
              <Badge variant="warning" size="sm">
                {t("admin.identities.notProvisioned")}
              </Badge>
            )}
          </html.div>
        )
      },
    }),
    columnHelper.accessor("type", {
      header: t("admin.cols.type"),
      size: 140,
      enableSorting: true,
      cell: ({ getValue }) => {
        const type = getValue()
        return <Badge variant={typeVariant[type]}>{enumLabel(t, "principalType", type)}</Badge>
      },
    }),
    columnHelper.accessor("email", {
      header: t("admin.cols.email"),
      enableSorting: true,
      cell: ({ getValue }) => getValue() ?? "—",
    }),
    columnHelper.display({
      id: "status",
      header: t("admin.cols.status"),
      cell: ({ row }) => {
        const { type, enabled, provisioned, activeCertCount } = row.original
        if (type === "user") {
          if (provisioned && !enabled) {
            return <Badge variant="error">{t("admin.identities.disabled")}</Badge>
          }
          return activeCertCount > 0 ? (
            <Badge variant="success">{t("admin.identities.activeCerts", { count: activeCertCount })}</Badge>
          ) : (
            <Badge variant="default">{t("admin.identities.noCerts")}</Badge>
          )
        }
        return (
          <Badge variant={enabled ? "success" : "default"}>{enabled ? t("admin.cols.yes") : t("admin.cols.no")}</Badge>
        )
      },
    }),
    columnHelper.display({
      id: "actions",
      header: t("admin.users.cols.actions"),
      enableSorting: false,
    }),
  ]
}

export default function AdminIdentitiesPage({ loaderData }: Route.ComponentProps) {
  "use no memo"
  const { t } = useTranslation()
  const { users, principals, revocations, systemUserIds, certsByUser } = loaderData

  const identities = useMemo(
    () => buildIdentities(users, principals, certsByUser as Record<string, UserCertificate[]>, systemUserIds),
    [users, principals, certsByUser, systemUserIds],
  )

  const [facet, setFacet] = useState<"all" | IdentityType>("all")
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeReason, setRevokeReason] = useState("")
  const [selectedCerts, setSelectedCerts] = useState<Set<string>>(new Set())
  const [certPanelUserId, setCertPanelUserId] = useState<string | null>(null)
  const [confirmBulk, setConfirmBulk] = useState<"users" | "certs" | null>(null)
  const sidePanel = useAdminSidePanel()
  // Depend on the stable setters, never the outlet-context object (rebuilt each
  // /admin render), to avoid the setContent→re-render feedback loop (React #185).
  const { onOpenChange, setContent, onCloseRef } = sidePanel

  const closeCertPanel = useCallback(() => {
    setCertPanelUserId(null)
    onOpenChange(false)
    setContent(null)
  }, [onOpenChange, setContent])

  onCloseRef.current = closeCertPanel

  const toggleCertPanel = useCallback(
    (userId: string) => {
      setCertPanelUserId((prev) => {
        if (prev === userId) {
          onOpenChange(false)
          setContent(null)
          return null
        }
        onOpenChange(true)
        return userId
      })
    },
    [onOpenChange, setContent],
  )

  const toggleCert = useCallback((serialNumber: string) => {
    setSelectedCerts((prev) => {
      const next = new Set(prev)
      if (next.has(serialNumber)) next.delete(serialNumber)
      else next.add(serialNumber)
      return next
    })
  }, [])

  useEffect(() => {
    if (certPanelUserId) {
      const identity = identities.find((i) => i.uid === certPanelUserId)
      const certs = (certsByUser as Record<string, UserCertificate[]>)[certPanelUserId] ?? []
      setContent(
        <CertPanelContent
          t={t}
          certPanelUser={identity ? { displayName: identity.displayName } : undefined}
          certPanelUserId={certPanelUserId}
          certPanelCerts={certs}
          selectedCerts={selectedCerts}
          toggleCert={toggleCert}
          onClose={closeCertPanel}
          onRevokeSelected={() => setConfirmBulk("certs")}
        />,
      )
    }
  }, [certPanelUserId, selectedCerts, identities, certsByUser, setContent, t, toggleCert, closeCertPanel])

  const revokeFetcher = useFetcher()
  const certRevokeFetcher = useFetcher()
  const userCertRevokeFetcher = useFetcher()
  const isRevoking = revokeFetcher.state !== "idle"
  const isRevokingUserCerts = userCertRevokeFetcher.state !== "idle"

  useFetcherToast(revokeFetcher)
  const certsRevokedToast = (data: unknown) => certBatchRevokeToast(data, t)
  useFetcherToast(certRevokeFetcher, { render: certsRevokedToast })
  useFetcherToast(userCertRevokeFetcher, { render: certsRevokedToast })

  const handleRevoke = (user: RevokeTarget) => {
    setRevokeTarget(user)
    setRevokeReason("")
    setSelectedCerts(new Set())
  }

  useEffect(() => {
    if (revokeFetcher.data && "success" in revokeFetcher.data) {
      setRevokeTarget(null)
    }
  }, [revokeFetcher.data])

  const handleConfirmRevoke = () => {
    if (!revokeTarget) return
    revokeFetcher.submit(
      { intent: "revokeUser", username: revokeTarget.id, email: revokeTarget.email, reason: revokeReason },
      { method: "post" },
    )
  }

  const handleRevokeCerts = () => {
    certRevokeFetcher.submit(buildBatchForm("revokeCertsBatch", "serialNumbers", selectedCerts), { method: "post" })
    setSelectedCerts(new Set())
  }

  const columns = useMemo(() => buildIdentityColumns(t), [t])

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: identities,
    columns,
    state: { sorting, columnFilters, pagination, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Only human users with active certs can be bulk-selected for cert revoke.
    enableRowSelection: (row) => row.original.type === "user" && row.original.hasActiveCerts && !row.original.isSystem,
  })

  const handleRevokeUserCerts = () => {
    const ids = Object.keys(table.getState().rowSelection)
      .map((idx) => table.getRowModel().rows[Number(idx)]?.original.uid)
      .filter((u): u is string => Boolean(u))
    userCertRevokeFetcher.submit(buildBatchForm("revokeAllCertsBatch", "usernames", ids), { method: "post" })
    table.resetRowSelection()
  }

  const selectedUserIds = Object.keys(table.getState().rowSelection)
    .map((idx) => table.getRowModel().rows[Number(idx)]?.original.uid)
    .filter(Boolean)

  // Type facet drives the `type` column filter. Counts per type for the chips.
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: identities.length }
    for (const i of identities) c[i.type] = (c[i.type] ?? 0) + 1
    return c
  }, [identities])

  const applyFacet = (next: "all" | IdentityType) => {
    setFacet(next)
    table.getColumn("type")?.setFilterValue(next === "all" ? undefined : next)
  }

  const setNameFilter = (value: string | null) => {
    table.getColumn("displayName")?.setFilterValue(value || undefined)
  }

  const facetChips: Array<{ value: "all" | IdentityType; label: string }> = [
    { value: "all", label: t("admin.identities.facet.all") },
    { value: "user", label: enumLabel(t, "principalType", "user") },
    { value: "group", label: enumLabel(t, "principalType", "group") },
    { value: "service_account", label: enumLabel(t, "principalType", "service_account") },
    { value: "device", label: enumLabel(t, "principalType", "device") },
  ]

  const sectionTitle = (
    <>
      {t("admin.identities.title")}
      <HelpPopover termKey="glossary.identities" />
    </>
  )

  if (identities.length === 0 && revocations.length === 0) {
    return (
      <Stack gap="md">
        <CardSection title={sectionTitle}>
          <EmptyState message={t("admin.identities.empty")} />
        </CardSection>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <CardSection
        title={
          <>
            {sectionTitle} ({identities.length})
          </>
        }
      >
        <html.div style={styles.filterRow}>
          <ToggleGroup
            size="small"
            value={[facet]}
            onValueChange={(v) => applyFacet((v[0] as "all" | IdentityType) ?? "all")}
          >
            {facetChips.map((chip) => {
              const count = typeCounts[chip.value] ?? 0
              if (chip.value !== "all" && count === 0) return null
              return (
                <Toggle key={chip.value} value={chip.value} aria-label={chip.label}>
                  {chip.label} · {count}
                </Toggle>
              )
            })}
          </ToggleGroup>
          <Combobox.Root onValueChange={setNameFilter} onInputChange={setNameFilter}>
            <Combobox.Input placeholder={t("admin.principals.filterByName")} />
            <Combobox.Popup>
              {identities.map((i) => (
                <Combobox.Item key={i.key} value={i.displayName}>
                  {i.displayName}
                </Combobox.Item>
              ))}
              <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
            </Combobox.Popup>
          </Combobox.Root>
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
                {headerGroup.headers.map((header) => {
                  const isActions = header.column.columnDef.id === "actions"
                  return (
                    <Table.HeaderCell
                      key={header.id}
                      label={String(header.column.columnDef.header ?? "")}
                      width={isActions ? "max-content" : header.getSize() !== 150 ? `${header.getSize()}px` : undefined}
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
                  )
                })}
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
                        <IdentityActions
                          identity={row.original}
                          certPanelUserId={certPanelUserId}
                          onRevoke={handleRevoke}
                          onViewCerts={toggleCertPanel}
                          t={t}
                        />
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

      {/* Single contextual bar: driven by row selection. Cert-level revoke now
          lives inside the identity's cert detail panel, and single-user revoke
          is a row action → dialog — so this is the only page-level ActionBar. */}
      <ActionBar
        selectedItemCount={selectedUserIds.length}
        selectedLabel={(count) => t("admin.users.certs.usersSelected", { count: Number(count) })}
        onClearSelection={() => table.resetRowSelection()}
      >
        <Button variant="danger" size="small" disabled={isRevokingUserCerts} onClick={() => setConfirmBulk("users")}>
          {isRevokingUserCerts
            ? t("admin.users.actions.revoking")
            : t("admin.users.certs.revokeAllForUsers", { count: selectedUserIds.length })}
        </Button>
      </ActionBar>

      <Dialog.Root open={confirmBulk !== null} onOpenChange={(o) => !o && setConfirmBulk(null)}>
        <Dialog.Portal size="sm">
          <Dialog.Header>
            <Dialog.Title>
              {confirmBulk === "users"
                ? t("admin.users.certs.confirmRevokeUsersTitle")
                : t("admin.users.certs.confirmRevokeCertsTitle")}
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              <Text as="p">
                {confirmBulk === "users"
                  ? t("admin.users.certs.confirmRevokeUsersBody", { count: selectedUserIds.length })
                  : t("admin.users.certs.confirmRevokeCertsBody", { count: selectedCerts.size })}
              </Text>
              <Text as="p" color="muted" variant="bodySm">
                {t("admin.users.certs.confirmRevokeWarning")}
              </Text>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Inline gap="sm">
              <Button variant="secondary" onClick={() => setConfirmBulk(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (confirmBulk === "users") handleRevokeUserCerts()
                  else if (confirmBulk === "certs") handleRevokeCerts()
                  setConfirmBulk(null)
                }}
              >
                {t("admin.users.actions.confirmRevoke")}
              </Button>
            </Inline>
          </Dialog.Footer>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Single-user revoke — a row action opens this dialog with the reason
          field inside it (replacing the old swapping revoke ActionBar). */}
      <Dialog.Root open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <Dialog.Portal size="sm">
          <Dialog.Header>
            <Dialog.Title>{t("admin.users.actions.confirmRevokeUserTitle")}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              <Text as="p">
                {t("admin.users.actions.confirmRevokeUserBody", {
                  user: revokeTarget?.displayName ?? revokeTarget?.id,
                })}
              </Text>
              <Input
                name="reason"
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason((e.target as HTMLInputElement).value)}
                placeholder={t("admin.users.actions.reasonPlaceholder")}
              />
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Inline gap="sm">
              <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" disabled={isRevoking} onClick={() => handleConfirmRevoke()}>
                {isRevoking ? t("admin.users.actions.revoking") : t("admin.users.actions.confirmRevoke")}
              </Button>
            </Inline>
          </Dialog.Footer>
        </Dialog.Portal>
      </Dialog.Root>

      {revocations.length > 0 && (
        <CardSection title={`${t("admin.users.revokedTitle")} (${revocations.length})`}>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("admin.users.cols.email")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.users.cols.username")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.users.cols.reason")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.users.cols.revoked")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.users.cols.by")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.users.cols.actions")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {revocations.map((r) => (
                <RevokedUserRow key={r.id} revocation={r} />
              ))}
            </Table.Body>
          </Table.Root>
        </CardSection>
      )}
    </Stack>
  )
}

// Row actions: human users get the cert/revoke controls (reusing ActionCell);
// non-user principals (group/service_account/device) are view-only and link to
// their governance detail.
function IdentityActions({
  identity,
  certPanelUserId,
  onRevoke,
  onViewCerts,
  t,
}: {
  identity: Identity
  certPanelUserId: string | null
  onRevoke: (user: RevokeTarget) => void
  onViewCerts: (userId: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  if (identity.type !== "user") {
    if (!identity.principalId) return null
    return (
      <LinkButton href={`/admin/principals/${identity.principalId}`} variant="secondary" size="small">
        {t("admin.identities.view")}
      </LinkButton>
    )
  }
  if (!identity.uid) return null
  return (
    <ActionCell
      row={{
        id: identity.uid,
        displayName: identity.displayName,
        email: identity.email ?? "",
        creationDate: identity.creationDate ?? "",
        certs: identity.certs,
        isSystem: identity.isSystem,
        hasActiveCerts: identity.hasActiveCerts,
        activeCertCount: identity.activeCertCount,
      }}
      certPanelUserId={certPanelUserId}
      onRevoke={onRevoke}
      onViewCerts={onViewCerts}
      t={t}
    />
  )
}
