import { useState, useEffect, useMemo } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.users"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo, type Revocation } from "~/lib/services/InviteRepo.server"
import { CertificateRepo, type UserCertificate } from "~/lib/services/CertificateRepo.server"
import { handleAdminUsersMutation, parseAdminUsersMutation } from "~/lib/mutations/admin-users"
import { useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, getFilteredRowModel, flexRender, createColumnHelper, type SortingState, type ColumnFiltersState } from "@tanstack/react-table"
import { certStatus } from "~/lib/cert-status"

import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { ActionBar, Badge, Button, ButtonGroup, Checkbox, Combobox, DetailPanel, Inline, Input, List, ScrollArea, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { useAdminSidePanel } from "./admin"

export async function loader() {
  const [users, revocations, certsByUser] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getUsers
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
  return { users, revocations, systemUserIds, certsByUser }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminUsersMutation(formData as any)
  if ("error" in parsed) return parsed

  return await runEffect(handleAdminUsersMutation(parsed))
}

interface RevokeTarget {
  id: string
  email: string
  displayName: string
}

// --- TanStack Table column definitions ---

type UserData = {
  id: string
  displayName: string
  email: string
  creationDate: string
  certs: UserCertificate[]
  isSystem: boolean
  hasActiveCerts: boolean
  activeCertCount: number
}

const columnHelper = createColumnHelper<UserData>()

function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
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
            aria-label={row.original.id}
          />
        )
      },
    }),
    columnHelper.accessor("id", {
      header: t("admin.users.cols.username"),
      size: 200,
      enableColumnFilter: true,
      enableSorting: true,
      cell: ({ row }) => {
        const { id, activeCertCount, certs } = row.original
        return (
          <>
            {id}
            {certs.length > 0 && (
              <>
                {" "}
                <Badge variant={activeCertCount > 0 ? "success" : "default"}>
                  {t("admin.users.certs.count", { count: activeCertCount })}
                </Badge>
              </>
            )}
          </>
        )
      },
    }),
    columnHelper.accessor("displayName", {
      header: t("admin.users.cols.displayName"),
      enableColumnFilter: true,
      enableSorting: true,
    }),
    columnHelper.accessor("email", {
      header: t("admin.users.cols.email"),
      size: 200,
      enableColumnFilter: true,
      enableSorting: true,
    }),
    columnHelper.accessor("creationDate", {
      header: t("admin.users.cols.created"),
      size: 120,
      enableSorting: true,
      enableColumnFilter: false,
      cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
    }),
    columnHelper.display({
      id: "actions",
      header: t("admin.users.cols.actions"),
      enableSorting: false,
      // Cell rendering is handled by ActionCell component in the table body
      // to allow proper useFetcher hook usage per row
      cell: () => null,
    }),
  ]
}

export default function AdminUsersPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { users, revocations, systemUserIds, certsByUser } = loaderData
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeReason, setRevokeReason] = useState("")
  const [selectedCerts, setSelectedCerts] = useState<Set<string>>(new Set())
  const [certPanelUserId, setCertPanelUserId] = useState<string | null>(null)
  const sidePanel = useAdminSidePanel()

  // Register close callback so ESC/close button syncs local state
  sidePanel.onCloseRef.current = () => setCertPanelUserId(null)

  const closeCertPanel = () => {
    setCertPanelUserId(null)
    sidePanel.onOpenChange(false)
    sidePanel.setContent(null)
  }

  const toggleCertPanel = (userId: string) => {
    if (certPanelUserId === userId) {
      closeCertPanel()
    } else {
      setCertPanelUserId(userId)
      sidePanel.onOpenChange(true)
    }
  }

  // Refresh panel content whenever certPanelUserId or selectedCerts changes.
  // This runs AFTER state is committed, so closures capture fresh values.
  useEffect(() => {
    if (certPanelUserId) {
      const user = users.find((u) => u.id === certPanelUserId)
      const certs = (certsByUser as Record<string, UserCertificate[]>)[certPanelUserId] ?? []
      sidePanel.setContent(
        <CertPanelContent
          t={t}
          certPanelUser={user}
          certPanelUserId={certPanelUserId}
          certPanelCerts={certs}
          selectedCerts={selectedCerts}
          toggleCert={toggleCert}
          onClose={closeCertPanel}
        />,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certPanelUserId, selectedCerts])

  const revokeFetcher = useFetcher()
  const certRevokeFetcher = useFetcher()
  const userCertRevokeFetcher = useFetcher()
  const isRevoking = revokeFetcher.state !== "idle"
  const isRevokingCerts = certRevokeFetcher.state !== "idle"
  const isRevokingUserCerts = userCertRevokeFetcher.state !== "idle"

  const handleRevoke = (user: RevokeTarget) => {
    setRevokeTarget(user)
    setRevokeReason("")
    setSelectedCerts(new Set())
  }

  const handleConfirmRevoke = () => {
    if (!revokeTarget) return
    revokeFetcher.submit(
      {
        intent: "revokeUser",
        username: revokeTarget.id,
        email: revokeTarget.email,
        reason: revokeReason,
      },
      { method: "post" },
    )
    setRevokeTarget(null)
  }

  const toggleCert = (serialNumber: string, userId: string) => {
    setSelectedCerts((prev) => {
      const next = new Set(prev)
      if (next.has(serialNumber)) next.delete(serialNumber)
      else next.add(serialNumber)
      return next
    })
  }

  const handleRevokeCerts = () => {
    for (const serial of selectedCerts) {
      certRevokeFetcher.submit({ intent: "revokeCert", serialNumber: serial }, { method: "post" })
    }
    setSelectedCerts(new Set())
  }

  const handleRevokeUserCerts = () => {
    const selectedUserIds = Object.keys(table.getState().rowSelection)
      .map((idx) => table.getRowModel().rows[Number(idx)]?.original.id)
      .filter(Boolean)
    for (const username of selectedUserIds) {
      userCertRevokeFetcher.submit({ intent: "revokeAllCerts", username }, { method: "post" })
    }
    table.resetRowSelection()
  }

  // Transform loader data into flat UserData[] for TanStack Table
  const userData: UserData[] = useMemo(
    () =>
      users.map((u) => {
        const userCerts = (certsByUser as Record<string, UserCertificate[]>)[u.id] ?? []
        const activeCerts = userCerts.filter((c) => certStatus(c) === "active")
        return {
          id: u.id,
          displayName: u.displayName,
          email: u.email,
          creationDate: u.creationDate,
          certs: userCerts,
          isSystem: systemUserIds.includes(u.id),
          hasActiveCerts: activeCerts.length > 0,
          activeCertCount: activeCerts.length,
        }
      }),
    [users, certsByUser, systemUserIds],
  )

  // Column defs are rebuilt when translation changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => buildColumns(t), [t])

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  const table = useReactTable({
    data: userData,
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
    enableRowSelection: (row) => row.original.hasActiveCerts && !row.original.isSystem,
  })

  // Derive selected user IDs from TanStack row selection
  const selectedUserIds = Object.keys(table.getState().rowSelection)
    .map((idx) => table.getRowModel().rows[Number(idx)]?.original.id)
    .filter(Boolean)

  // Only one ActionBar visible at a time: user selection > cert selection > revoke user
  const activeBar =
    selectedUserIds.length > 0 ? "users" : selectedCerts.size > 0 ? "certs" : revokeTarget ? "revoke" : null

  // Derive unique values for filterable columns
  const uniqueValues = useMemo(() => {
    const vals: Record<string, string[]> = {}
    for (const col of ["id", "displayName", "email"] as const) {
      vals[col] = [...new Set(userData.map((u) => u[col]))].sort()
    }
    return vals
  }, [userData])

  const setFilter = (columnId: string, value: string | null) => {
    table.getColumn(columnId)?.setFilterValue(value || undefined)
  }

  return (
    <Stack gap="md">
      <CardSection title={`${t("admin.users.title")} (${users.length})`}>
        <html.div style={filterBarStyles.bar}>
          <Inline gap="sm">
            {(["id", "displayName", "email"] as const).map((colId) => (
              <Combobox.Root
                key={colId}
                onValueChange={(v) => setFilter(colId, v)}
                onInputChange={(v) => setFilter(colId, v)}
              >
                <Combobox.Input placeholder={`${t(`admin.users.cols.${colId === "id" ? "username" : colId}`)}...`} />
                <Combobox.Popup>
                  {uniqueValues[colId].map((val) => (
                    <Combobox.Item key={val} value={val}>{val}</Combobox.Item>
                  ))}
                  <Combobox.Empty>{t("common.noResults", "No results")}</Combobox.Empty>
                </Combobox.Popup>
              </Combobox.Root>
            ))}
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
                        <Table.HeaderCell
                          key={header.id}
                          width={
                            header.column.columnDef.id === "actions"
                              ? "max-content"
                              : header.getSize() !== 150
                                ? `${header.getSize()}px`
                                : undefined
                          }
                        >
                          {header.isPlaceholder ? null : (
                            <>
                              {header.column.getCanSort() ? (
                                <html.span
                                  style={filterBarStyles.sortHeader}
                                  onClick={header.column.getToggleSortingHandler()}
                                >
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
                          {cell.column.id === "actions" ? (
                            <ActionCell
                              row={row.original}
                              certPanelUserId={certPanelUserId}
                              onRevoke={handleRevoke}
                              onViewCerts={toggleCertPanel}
                              t={t}
                            />
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
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
        <Table.Pagination table={table} />
      </CardSection>

      {/* User cert revoke ActionBar */}
      <ActionBar
        selectedItemCount={activeBar === "users" ? selectedUserIds.length : 0}
        selectedLabel={(count) => t("admin.users.certs.usersSelected", { count: Number(count) })}
        onClearSelection={() => table.resetRowSelection()}
      >
        <Button
          variant="danger"
          size="small"
          disabled={isRevokingUserCerts}
          onClick={handleRevokeUserCerts}
        >
          {isRevokingUserCerts
            ? t("admin.users.actions.revoking")
            : t("admin.users.certs.revokeAllForUsers", { count: selectedUserIds.length })}
        </Button>
      </ActionBar>

      {/* Cert selection ActionBar */}
      <ActionBar
        selectedItemCount={activeBar === "certs" ? selectedCerts.size : 0}
        selectedLabel={(count) => t("admin.users.certs.selected", { count: Number(count) })}
        onClearSelection={() => setSelectedCerts(new Set())}
      >
        <Button
          variant="danger"
          size="small"
          disabled={isRevokingCerts}
          onClick={handleRevokeCerts}
        >
          {isRevokingCerts
            ? t("admin.users.actions.revoking")
            : t("admin.users.certs.revokeSelected", { count: selectedCerts.size })}
        </Button>
      </ActionBar>

      {/* User revoke ActionBar */}
      <ActionBar
        selectedItemCount={activeBar === "revoke" ? 1 : 0}
        selectedLabel={() =>
          t("admin.users.actions.revokeLabel", { user: revokeTarget?.displayName ?? revokeTarget?.id })
        }
        onClearSelection={() => setRevokeTarget(null)}
      >
        <Input
          name="reason"
          type="text"
          value={revokeReason}
          onChange={(e) => setRevokeReason((e.target as HTMLInputElement).value)}
          placeholder={t("admin.users.actions.reasonPlaceholder")}
        />
        <Button variant="danger" size="small" disabled={isRevoking} onClick={handleConfirmRevoke}>
          {isRevoking ? t("admin.users.actions.revoking") : t("admin.users.actions.confirmRevoke")}
        </Button>
      </ActionBar>

      {revocations.length > 0 && (
        <CardSection title={`${t("admin.users.revokedTitle")} (${revocations.length})`}>
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
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
              </ScrollArea.Content>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="horizontal">
              <ScrollArea.Thumb orientation="horizontal" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </CardSection>
      )}
    </Stack>
  )
}

/**
 * ActionCell renders per-row actions with its own useFetcher for the "Send Cert" button.
 * This is a component (not a column cell render function) so useFetcher is called at the component level.
 */
function ActionCell({
  row,
  certPanelUserId,
  onRevoke,
  onViewCerts,
  t,
}: {
  row: UserData
  certPanelUserId: string | null
  onRevoke: (user: RevokeTarget) => void
  onViewCerts: (userId: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const certFetcher = useFetcher()
  const isSendingCert = certFetcher.state !== "idle"
  const { id, email, displayName, isSystem, activeCertCount, certs } = row
  const isPanelOpen = certPanelUserId === id

  if (isSystem) return null

  return (
    <ButtonGroup gap="xs">
      <certFetcher.Form method="post">
        <input type="hidden" name="intent" value="resendCert" />
        <input type="hidden" name="username" value={id} />
        <input type="hidden" name="email" value={email} />
        <Button type="submit" variant="secondary" size="small" disabled={isSendingCert}>
          {isSendingCert ? t("admin.users.actions.sendingCert") : t("admin.users.actions.sendCert")}
        </Button>
      </certFetcher.Form>
      {certs.length > 0 && (
        <Button
          type="button"
          variant={isPanelOpen ? "primary" : "secondary"}
          size="small"
          onClick={() => onViewCerts(id)}
        >
          {t("admin.users.actions.viewCerts")}
        </Button>
      )}
      <Button
        type="button"
        variant="danger"
        size="small"
        onClick={() => onRevoke({ id, email, displayName })}
      >
        {activeCertCount > 0 ? t("admin.users.certs.revokeAll") : t("admin.users.actions.revoke")}
      </Button>
    </ButtonGroup>
  )
}

function CertRevokeButton({ serialNumber, t }: { serialNumber: string; t: (key: string) => string }) {
  const fetcher = useFetcher()
  const isRevoking = fetcher.state !== "idle"

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="revokeCert" />
      <input type="hidden" name="serialNumber" value={serialNumber} />
      <Button type="submit" variant="danger" size="small" disabled={isRevoking}>
        {isRevoking ? t("admin.users.actions.revoking") : t("admin.users.certs.revokeCert")}
      </Button>
    </fetcher.Form>
  )
}

function CertPanelContent({
  t,
  certPanelUser,
  certPanelUserId,
  certPanelCerts,
  selectedCerts,
  toggleCert,
  onClose,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string
  certPanelUser: { displayName: string } | undefined
  certPanelUserId: string
  certPanelCerts: UserCertificate[]
  selectedCerts: Set<string>
  toggleCert: (serialNumber: string, userId: string) => void
  onClose: () => void
}) {
  return (
    <>
      <DetailPanel.Header>
        <DetailPanel.Title>
          {t("admin.users.actions.viewCerts")} — {certPanelUser?.displayName || certPanelUserId}
        </DetailPanel.Title>
        <DetailPanel.Close />
      </DetailPanel.Header>
      <DetailPanel.Body padded={false}>
        <List.Root selectionMode="multiple" aria-label={t("admin.users.actions.viewCerts")}>
          {certPanelCerts.map((cert) => {
            const status = certStatus(cert)
            const isActive = status === "active"
            return (
              <List.Item
                key={cert.id}
                selected={selectedCerts.has(cert.serialNumber)}
                disabled={!isActive}
                onClick={isActive ? () => toggleCert(cert.serialNumber, certPanelUserId) : undefined}
              >
                {isActive && (
                  <Checkbox
                    checked={selectedCerts.has(cert.serialNumber)}
                    onChange={() => toggleCert(cert.serialNumber, certPanelUserId)}
                    aria-label={cert.serialNumber}
                  />
                )}
                <List.Content>
                  <List.Text>{cert.serialNumber?.slice(0, 16)}…</List.Text>
                  <List.Description>
                    {t("admin.users.certs.issued")}: {new Date(cert.issuedAt).toLocaleDateString()} · {t("admin.users.certs.expires")}: {new Date(cert.expiresAt).toLocaleDateString()}
                  </List.Description>
                </List.Content>
                <List.Actions>
                  <Badge variant={isActive ? "success" : status === "expired" ? "default" : "error"} size="sm">
                    {t(`admin.users.certs.${status}`)}
                  </Badge>
                  {isActive && (
                    <CertRevokeButton serialNumber={cert.serialNumber} t={t} />
                  )}
                </List.Actions>
              </List.Item>
            )
          })}
          {certPanelCerts.length === 0 && (
            <List.Empty>{t("admin.users.certs.empty")}</List.Empty>
          )}
        </List.Root>
      </DetailPanel.Body>
    </>
  )
}

const filterBarStyles = css.create({
  bar: {
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

function RevokedUserRow({ revocation }: { revocation: Revocation }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{revocation.email}</Table.Cell>
      <Table.Cell>{revocation.username}</Table.Cell>
      <Table.Cell>{revocation.reason ?? "\u2014"}</Table.Cell>
      <Table.Cell>{new Date(revocation.revokedAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>{revocation.revokedBy}</Table.Cell>
      <Table.Cell>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="reinviteRevoked" />
          <input type="hidden" name="revocationId" value={revocation.id} />
          <Button type="submit" variant="secondary" size="small" disabled={isSubmitting}>
            {isSubmitting ? t("admin.users.actions.processing") : t("admin.users.actions.reinvite")}
          </Button>
        </fetcher.Form>
      </Table.Cell>
    </Table.Row>
  )
}
