import { useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.invitations"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { AccessInvitationRepo } from "~/lib/governance/AccessInvitationRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import type { AccessInvitation, Role, Entitlement } from "~/lib/governance/types"
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
import { Badge, Button, Dialog, Field, Input, Select, Stack, Table } from "@duro-app/ui"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

export async function loader() {
  const [applications, principals, roles, entitlements] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        return yield* repo.list()
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
        const repo = yield* RbacRepo
        return yield* repo.listAllRoles()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listAllEntitlements()
      }),
    ),
  ])

  // Collect all invitations across all apps
  const invitations: AccessInvitation[] = []
  for (const app of applications) {
    const appInvitations = await runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessInvitationRepo
        return yield* repo.listForApp(app.id)
      }),
    )
    invitations.push(...appInvitations)
  }

  return { invitations, applications, principals, roles, entitlements }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string
  const auth = await getAuth(request)
  const actorId = auth.user ?? "system"

  if (intent === "createInvitation") {
    const applicationId = formData.get("applicationId") as string
    const invitedPrincipalId = formData.get("invitedPrincipalId") as string
    const roleId = (formData.get("roleId") as string) || undefined
    const entitlementId = (formData.get("entitlementId") as string) || undefined
    const message = (formData.get("message") as string) || undefined

    if (!applicationId || !invitedPrincipalId) {
      return { error: "Application and principal are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessInvitationRepo
        return yield* repo.create({
          applicationId,
          invitedPrincipalId,
          invitedBy: actorId,
          roleId,
          entitlementId,
          message,
        })
      }),
    )
    return { success: true }
  }

  return { error: "Unknown intent" }
}

const columnHelper = createColumnHelper<AccessInvitation>()

// Resolve opaque ids to human names; fall back to the raw id (or an em-dash for
// empty optional columns) so nothing ever renders as a bare uuid the admin
// can't read.
interface NameResolvers {
  app: (id: string) => string
  principal: (id: string) => string
  role: (id: string | null) => string
  entitlement: (id: string | null) => string
}

const buildColumns = (r: NameResolvers) => [
  columnHelper.accessor("status", {
    header: "Status",
    enableSorting: true,
    cell: ({ getValue }) => {
      const status = getValue()
      const variant =
        status === "pending"
          ? "warning"
          : status === "accepted"
            ? "success"
            : status === "declined"
              ? "error"
              : "default"
      return <Badge variant={variant}>{status}</Badge>
    },
  }),
  columnHelper.accessor("applicationId", {
    header: "Application",
    enableSorting: true,
    cell: ({ getValue }) => r.app(getValue()),
  }),
  columnHelper.accessor("invitedPrincipalId", {
    header: "Invited Principal",
    enableSorting: true,
    cell: ({ getValue }) => r.principal(getValue()),
  }),
  columnHelper.accessor("invitedBy", {
    header: "Invited By",
    cell: ({ getValue }) => r.principal(getValue()),
  }),
  columnHelper.accessor("roleId", {
    header: "Role",
    cell: ({ getValue }) => r.role(getValue()),
  }),
  columnHelper.accessor("entitlementId", {
    header: "Entitlement",
    cell: ({ getValue }) => r.entitlement(getValue()),
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    enableSorting: true,
    cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
  }),
]

export default function AdminInvitationsPage({ loaderData }: Route.ComponentProps) {
  const { invitations, applications, principals, roles = [], entitlements = [] } = loaderData
  const fetcher = useFetcher()
  useFetcherToast(fetcher, { successMessage: "Invitation created" })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedAppId, setSelectedAppId] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const isCreating = fetcher.state !== "idle"

  const columns = useMemo(() => {
    const appName = new Map(applications.map((a) => [a.id, a.displayName]))
    const principalName = new Map(principals.map((p) => [p.id, p.displayName]))
    const roleName = new Map((roles as Role[]).map((x) => [x.id, x.displayName]))
    const entName = new Map((entitlements as Entitlement[]).map((x) => [x.id, x.displayName]))
    return buildColumns({
      app: (id) => appName.get(id) ?? id,
      principal: (id) => principalName.get(id) ?? id,
      role: (id) => (id ? (roleName.get(id) ?? id) : "—"),
      entitlement: (id) => (id ? (entName.get(id) ?? id) : "—"),
    })
  }, [applications, principals, roles, entitlements])

  // Roles/entitlements scoped to the app chosen in the create dialog.
  const appRoles = (roles as Role[]).filter((x) => x.applicationId === selectedAppId)
  const appEntitlements = (entitlements as Entitlement[]).filter((x) => x.applicationId === selectedAppId)

  const table = useReactTable({
    data: invitations,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <Stack gap="md">
      <CardSection
        title={
          <>
            Access Invitations ({invitations.length})
            <HelpPopover termKey="glossary.invitations" />
          </>
        }
        action={
          <Button variant="primary" size="small" onClick={() => setDialogOpen(true)}>
            Create Invitation
          </Button>
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
            {table.getRowModel().rows.map((row) => (
              <Table.Row key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <Table.Cell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </CardSection>

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Access Invitation</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createInvitation" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Application</Field.Label>
                  <Select.Root
                    name="applicationId"
                    value={selectedAppId}
                    onValueChange={(v) => setSelectedAppId(v ?? "")}
                  >
                    <Select.Trigger aria-label="Application">
                      <Select.Value placeholder="Select application" />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {applications.map((app) => (
                        <Select.Item key={app.id} value={app.id}>
                          <Select.ItemText>{app.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Principal</Field.Label>
                  <Select.Root name="invitedPrincipalId">
                    <Select.Trigger aria-label="Principal">
                      <Select.Value placeholder="Select principal" />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {principals.map((p) => (
                        <Select.Item key={p.id} value={p.id}>
                          <Select.ItemText>{p.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Role</Field.Label>
                  <Select.Root name="roleId">
                    <Select.Trigger aria-label="Role">
                      <Select.Value
                        placeholder={selectedAppId ? "Optional — pick a role" : "Pick an application first"}
                      />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {appRoles.map((role) => (
                        <Select.Item key={role.id} value={role.id}>
                          <Select.ItemText>{role.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Entitlement</Field.Label>
                  <Select.Root name="entitlementId">
                    <Select.Trigger aria-label="Entitlement">
                      <Select.Value
                        placeholder={selectedAppId ? "Optional — pick an entitlement" : "Pick an application first"}
                      />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {appEntitlements.map((ent) => (
                        <Select.Item key={ent.id} value={ent.id}>
                          <Select.ItemText>{ent.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Message</Field.Label>
                  <Input name="message" placeholder="Optional message" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create Invitation"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>
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
