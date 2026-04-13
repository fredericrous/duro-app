import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.group-mappings"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { GroupMappingRepo, type GroupMappingWithNames } from "~/lib/governance/GroupMappingRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import type { Application, Principal, Role } from "~/lib/governance/types"
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
import { Badge, Button, Dialog, Field, Input, ScrollArea, Select, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader() {
  const [mappings, applications, principals] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        return yield* repo.list()
      }),
    ),
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

  // Load roles for each application
  const rolesByApp: Record<string, Role[]> = {}
  for (const app of applications) {
    rolesByApp[app.id] = await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listRoles(app.id)
      }),
    )
  }

  const groups = principals.filter((p) => p.principalType === "group")

  return { mappings, applications, groups, rolesByApp }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string
  await getAuth(request)

  if (intent === "create") {
    const oidcGroupName = (formData.get("oidcGroupName") as string)?.trim()
    const mappingType = formData.get("mappingType") as string
    const principalGroupId = (formData.get("principalGroupId") as string) || undefined
    const roleId = (formData.get("roleId") as string) || undefined
    const applicationId = (formData.get("applicationId") as string) || undefined

    if (!oidcGroupName) {
      return { error: "OIDC group name is required" }
    }

    if (mappingType === "group" && !principalGroupId) {
      return { error: "Principal group is required" }
    }
    if (mappingType === "role" && (!roleId || !applicationId)) {
      return { error: "Application and role are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        return yield* repo.create(
          mappingType === "group" ? { oidcGroupName, principalGroupId } : { oidcGroupName, roleId, applicationId },
        )
      }),
    )
    return { success: true }
  }

  if (intent === "delete") {
    const id = formData.get("id") as string
    if (!id) return { error: "Mapping ID is required" }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        return yield* repo.remove(id)
      }),
    )
    return { success: true }
  }

  return { error: "Unknown intent" }
}

const columnHelper = createColumnHelper<GroupMappingWithNames>()

const columns = [
  columnHelper.accessor("oidcGroupName", {
    header: "OIDC Group",
    enableSorting: true,
  }),
  columnHelper.display({
    id: "type",
    header: "Type",
    cell: ({ row }) =>
      row.original.principalGroupId ? <Badge variant="info">Group</Badge> : <Badge variant="default">Role</Badge>,
  }),
  columnHelper.display({
    id: "target",
    header: "Target",
    cell: ({ row }) => {
      const m = row.original
      if (m.principalGroupId) {
        return m.principalGroupName ?? m.principalGroupId
      }
      const parts = [m.applicationName ?? m.applicationId, m.roleName ?? m.roleId].filter(Boolean)
      return parts.join(" / ")
    },
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    enableSorting: true,
    cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
  }),
  columnHelper.display({
    id: "actions",
    header: "",
    cell: () => null, // rendered via DeleteCell
  }),
]

export default function AdminGroupMappingsPage({ loaderData }: Route.ComponentProps) {
  const { mappings, applications, groups, rolesByApp } = loaderData
  const fetcher = useFetcher()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [mappingType, setMappingType] = useState("group")
  const [selectedAppId, setSelectedAppId] = useState("")

  const isCreating = fetcher.state !== "idle"

  const table = useReactTable({
    data: mappings,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const rolesForSelectedApp = selectedAppId ? (rolesByApp[selectedAppId] ?? []) : []

  return (
    <Stack gap="md">
      <CardSection
        title={`Group Mappings (${mappings.length})`}
        action={
          <Button variant="primary" size="small" onClick={() => setDialogOpen(true)}>
            Add Mapping
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
                          {cell.column.id === "actions" ? (
                            <DeleteCell mappingId={row.original.id} />
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

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Add Group Mapping</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="mappingType" value={mappingType} />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>OIDC Group Name</Field.Label>
                  <Input name="oidcGroupName" placeholder="e.g. media_users" required />
                  <Field.Description>The group name as it appears in OIDC claims</Field.Description>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Mapping Type</Field.Label>
                  <Select.Root
                    value={mappingType}
                    onValueChange={(v: string | null) => {
                      if (v) {
                        setMappingType(v)
                        setSelectedAppId("")
                      }
                    }}
                  >
                    <Select.Trigger aria-label="Mapping type">
                      <Select.Value />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      <Select.Item value="group">
                        <Select.ItemText>Principal Group</Select.ItemText>
                      </Select.Item>
                      <Select.Item value="role">
                        <Select.ItemText>Application Role</Select.ItemText>
                      </Select.Item>
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>

                {mappingType === "group" && (
                  <Field.Root>
                    <Field.Label>Principal Group</Field.Label>
                    <Select.Root name="principalGroupId">
                      <Select.Trigger aria-label="Principal group">
                        <Select.Value placeholder="Select group" />
                        <Select.Icon />
                      </Select.Trigger>
                      <Select.Popup>
                        {groups.map((g: Principal) => (
                          <Select.Item key={g.id} value={g.id}>
                            <Select.ItemText>{g.displayName}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Popup>
                    </Select.Root>
                  </Field.Root>
                )}

                {mappingType === "role" && (
                  <>
                    <Field.Root>
                      <Field.Label>Application</Field.Label>
                      <Select.Root
                        name="applicationId"
                        value={selectedAppId}
                        onValueChange={(v: string | null) => setSelectedAppId(v ?? "")}
                      >
                        <Select.Trigger aria-label="Application">
                          <Select.Value placeholder="Select application" />
                          <Select.Icon />
                        </Select.Trigger>
                        <Select.Popup>
                          {applications.map((app: Application) => (
                            <Select.Item key={app.id} value={app.id}>
                              <Select.ItemText>{app.displayName}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Popup>
                      </Select.Root>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Role</Field.Label>
                      <Select.Root name="roleId">
                        <Select.Trigger aria-label="Role">
                          <Select.Value placeholder={selectedAppId ? "Select role" : "Select an application first"} />
                          <Select.Icon />
                        </Select.Trigger>
                        <Select.Popup>
                          {rolesForSelectedApp.map((r: Role) => (
                            <Select.Item key={r.id} value={r.id}>
                              <Select.ItemText>{r.displayName}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Popup>
                      </Select.Root>
                    </Field.Root>
                  </>
                )}

                <Button type="submit" variant="primary" disabled={isCreating}>
                  {isCreating ? "Creating..." : "Add Mapping"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  )
}

function DeleteCell({ mappingId }: { mappingId: string }) {
  const fetcher = useFetcher()
  const isDeleting = fetcher.state !== "idle"

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="delete" />
      <input type="hidden" name="id" value={mappingId} />
      <Button type="submit" variant="danger" size="small" disabled={isDeleting}>
        {isDeleting ? "Deleting..." : "Delete"}
      </Button>
    </fetcher.Form>
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
