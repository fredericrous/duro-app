import { useState, useMemo } from "react"
import { useFetcher, useNavigate } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.applications"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
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
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Badge, Button, Dialog, Field, Input, Select, ScrollArea, Stack, Table } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

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
  const intent = formData.get("intent") as string

  if (intent === "createApplication") {
    const slug = formData.get("slug") as string
    const displayName = formData.get("displayName") as string
    const description = (formData.get("description") as string) || undefined
    const accessMode = (formData.get("accessMode") as string) || undefined

    if (!slug || !displayName) {
      return { error: "Slug and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        return yield* repo.create({ slug, displayName, description, accessMode })
      }),
    )
    return { success: true }
  }

  return { error: "Unknown intent" }
}

const columnHelper = createColumnHelper<Application>()

const columns = [
  columnHelper.accessor("displayName", {
    header: "Name",
    enableSorting: true,
  }),
  columnHelper.accessor("slug", {
    header: "Slug",
    enableSorting: true,
  }),
  columnHelper.accessor("accessMode", {
    header: "Access Mode",
    enableSorting: true,
    cell: ({ getValue }) => {
      const mode = getValue()
      const variant = mode === "open" ? "success" : mode === "request" ? "warning" : "default"
      return <Badge variant={variant}>{mode}</Badge>
    },
  }),
  columnHelper.accessor("enabled", {
    header: "Enabled",
    enableSorting: true,
    cell: ({ getValue }) => (
      <Badge variant={getValue() ? "success" : "default"}>
        {getValue() ? "Yes" : "No"}
      </Badge>
    ),
  }),
  columnHelper.accessor("ownerId", {
    header: "Owner",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

export default function AdminApplicationsPage({ loaderData }: Route.ComponentProps) {
  const { applications } = loaderData
  const navigate = useNavigate()
  const fetcher = useFetcher()
  const [dialogOpen, setDialogOpen] = useState(false)
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

  const isCreating = fetcher.state !== "idle"

  return (
    <Stack gap="md">
      <CardSection
        title={`Applications (${applications.length})`}
        action={
          <Button variant="primary" size="small" onClick={() => setDialogOpen(true)}>
            Create Application
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
                                <html.span
                                  style={styles.sortHeader}
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
                    <html.div
                      key={row.id}
                      onClick={() => navigate(`/admin/applications/${row.original.id}`)}
                      style={styles.clickableRow}
                    >
                      <Table.Row>
                        {row.getVisibleCells().map((cell) => (
                          <Table.Cell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    </html.div>
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
            <Dialog.Title>Create Application</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form
              method="post"
              onSubmit={() => {
                // Close dialog after submission begins
                setTimeout(() => setDialogOpen(false), 0)
              }}
            >
              <input type="hidden" name="intent" value="createApplication" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Slug</Field.Label>
                  <Input name="slug" placeholder="my-app" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="My Application" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input name="description" placeholder="Optional description" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Access Mode</Field.Label>
                  <Select.Root name="accessMode" defaultValue="invite_only">
                    <Select.Trigger aria-label="Access Mode">
                      <Select.Value placeholder="Select access mode" />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      <Select.Item value="open"><Select.ItemText>Open</Select.ItemText></Select.Item>
                      <Select.Item value="request"><Select.ItemText>Request</Select.ItemText></Select.Item>
                      <Select.Item value="invite_only"><Select.ItemText>Invite Only</Select.ItemText></Select.Item>
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create"}
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
  clickableRow: {
    cursor: "pointer",
  },
})
