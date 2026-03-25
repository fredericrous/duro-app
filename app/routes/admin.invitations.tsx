import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.invitations"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { AccessInvitationRepo } from "~/lib/governance/AccessInvitationRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import type { AccessInvitation } from "~/lib/governance/types"
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
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Badge, Button, Combobox, Dialog, Field, Input, ScrollArea, Select, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader() {
  const [applications, principals] = await Promise.all([
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

  return { invitations, applications, principals }
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

const columns = [
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
  }),
  columnHelper.accessor("invitedPrincipalId", {
    header: "Invited Principal",
    enableSorting: true,
  }),
  columnHelper.accessor("invitedBy", {
    header: "Invited By",
  }),
  columnHelper.accessor("roleId", {
    header: "Role",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("entitlementId", {
    header: "Entitlement",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    enableSorting: true,
    cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
  }),
]

export default function AdminInvitationsPage({ loaderData }: Route.ComponentProps) {
  const { invitations, applications, principals } = loaderData
  const fetcher = useFetcher()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const isCreating = fetcher.state !== "idle"

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
        title={`Access Invitations (${invitations.length})`}
        action={
          <Button variant="primary" size="small" onClick={() => setDialogOpen(true)}>
            Create Invitation
          </Button>
        }
      >
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <ScrollArea.Content>
              <Table.Root>
                <Table.Header>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <Table.Row key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <Table.HeaderCell key={header.id}>
                          {header.isPlaceholder ? null : (
                            <>
                              {header.column.getCanSort() ? (
                                <html.span style={styles.sortHeader} onClick={header.column.getToggleSortingHandler()}>
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
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                  <Select.Root name="applicationId">
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
                  <Field.Label>Role ID</Field.Label>
                  <Input name="roleId" placeholder="Optional role ID" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Entitlement ID</Field.Label>
                  <Input name="entitlementId" placeholder="Optional entitlement ID" />
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
