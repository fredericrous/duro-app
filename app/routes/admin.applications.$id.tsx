import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.applications.$id"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import type { Role, Entitlement, Resource, Grant } from "~/lib/governance/types"
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Badge, Button, Dialog, Field, Heading, Input, ScrollArea, Stack, Tabs, Table, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader({ params }: Route.LoaderArgs) {
  const appId = params.id

  const [application, roles, entitlements, resources, grants] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        return yield* repo.findById(appId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listRoles(appId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listEntitlements(appId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listResources(appId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        // Get all grants that reference roles/entitlements in this app
        // For now we list via roles; a more complete approach would union role+entitlement grants
        return [] as Grant[]
      }),
    ),
  ])

  if (!application) {
    throw new Response("Application not found", { status: 404 })
  }

  return { application, roles, entitlements, resources, grants }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string
  const appId = params.id

  if (intent === "createRole") {
    const slug = formData.get("slug") as string
    const displayName = formData.get("displayName") as string
    const description = (formData.get("description") as string) || undefined

    if (!slug || !displayName) {
      return { error: "Slug and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createRole(appId, slug, displayName, description)
      }),
    )
    return { success: true }
  }

  if (intent === "createEntitlement") {
    const slug = formData.get("slug") as string
    const displayName = formData.get("displayName") as string
    const description = (formData.get("description") as string) || undefined

    if (!slug || !displayName) {
      return { error: "Slug and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createEntitlement(appId, slug, displayName, description)
      }),
    )
    return { success: true }
  }

  if (intent === "createResource") {
    const resourceType = formData.get("resourceType") as string
    const displayName = formData.get("displayName") as string
    const externalId = (formData.get("externalId") as string) || undefined
    const path = (formData.get("path") as string) || undefined

    if (!resourceType || !displayName) {
      return { error: "Resource type and display name are required" }
    }

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.createResource({
          applicationId: appId,
          resourceType,
          displayName,
          externalId,
          path,
        })
      }),
    )
    return { success: true }
  }

  return { error: "Unknown intent" }
}

// --- Column definitions ---

const roleColumnHelper = createColumnHelper<Role>()
const roleColumns = [
  roleColumnHelper.accessor("slug", { header: "Slug" }),
  roleColumnHelper.accessor("displayName", { header: "Name" }),
  roleColumnHelper.accessor("description", {
    header: "Description",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  roleColumnHelper.accessor("maxDurationHours", {
    header: "Max Duration",
    cell: ({ getValue }) => {
      const v = getValue()
      return v != null ? `${v}h` : "Unlimited"
    },
  }),
]

const entitlementColumnHelper = createColumnHelper<Entitlement>()
const entitlementColumns = [
  entitlementColumnHelper.accessor("slug", { header: "Slug" }),
  entitlementColumnHelper.accessor("displayName", { header: "Name" }),
  entitlementColumnHelper.accessor("description", {
    header: "Description",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

const resourceColumnHelper = createColumnHelper<Resource>()
const resourceColumns = [
  resourceColumnHelper.accessor("displayName", { header: "Name" }),
  resourceColumnHelper.accessor("resourceType", { header: "Type" }),
  resourceColumnHelper.accessor("externalId", {
    header: "External ID",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
  resourceColumnHelper.accessor("path", {
    header: "Path",
    cell: ({ getValue }) => getValue() ?? "\u2014",
  }),
]

export default function AdminApplicationDetailPage({ loaderData }: Route.ComponentProps) {
  const { application, roles, entitlements, resources, grants } = loaderData
  const fetcher = useFetcher()
  const [activeTab, setActiveTab] = useState("roles")
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [entitlementDialogOpen, setEntitlementDialogOpen] = useState(false)
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false)

  const isSubmitting = fetcher.state !== "idle"

  const rolesTable = useReactTable({
    data: roles,
    columns: roleColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const entitlementsTable = useReactTable({
    data: entitlements,
    columns: entitlementColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const resourcesTable = useReactTable({
    data: resources,
    columns: resourceColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Stack gap="md">
      <html.div>
        <Heading level={2}>{application.displayName}</Heading>
        <Text color="muted">
          {application.slug} &middot;{" "}
          <Badge
            variant={
              application.accessMode === "open"
                ? "success"
                : application.accessMode === "request"
                  ? "warning"
                  : "default"
            }
          >
            {application.accessMode}
          </Badge>{" "}
          &middot;{" "}
          <Badge variant={application.enabled ? "success" : "default"}>
            {application.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </Text>
        {application.description && <Text>{application.description}</Text>}
      </html.div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="roles">Roles ({roles.length})</Tabs.Tab>
          <Tabs.Tab value="entitlements">Entitlements ({entitlements.length})</Tabs.Tab>
          <Tabs.Tab value="resources">Resources ({resources.length})</Tabs.Tab>
          <Tabs.Tab value="grants">Grants ({grants.length})</Tabs.Tab>
        </Tabs.List>

        <html.div style={styles.tabContent}>
          {activeTab === "roles" && (
            <CardSection
              title="Roles"
              action={
                <Button variant="primary" size="small" onClick={() => setRoleDialogOpen(true)}>
                  Add Role
                </Button>
              }
            >
              <DataTable table={rolesTable} />
            </CardSection>
          )}

          {activeTab === "entitlements" && (
            <CardSection
              title="Entitlements"
              action={
                <Button variant="primary" size="small" onClick={() => setEntitlementDialogOpen(true)}>
                  Add Entitlement
                </Button>
              }
            >
              <DataTable table={entitlementsTable} />
            </CardSection>
          )}

          {activeTab === "resources" && (
            <CardSection
              title="Resources"
              action={
                <Button variant="primary" size="small" onClick={() => setResourceDialogOpen(true)}>
                  Add Resource
                </Button>
              }
            >
              <DataTable table={resourcesTable} />
            </CardSection>
          )}

          {activeTab === "grants" && (
            <CardSection title="Grants">
              {grants.length === 0 ? (
                <Text color="muted">No grants for this application yet.</Text>
              ) : (
                <Text color="muted">Grant listing coming soon.</Text>
              )}
            </CardSection>
          )}
        </html.div>
      </Tabs.Root>

      {/* Create Role Dialog */}
      <Dialog.Root open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Role</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setRoleDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createRole" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Slug</Field.Label>
                  <Input name="slug" placeholder="admin" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="Administrator" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input name="description" placeholder="Optional description" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Role"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Create Entitlement Dialog */}
      <Dialog.Root open={entitlementDialogOpen} onOpenChange={setEntitlementDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Entitlement</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setEntitlementDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createEntitlement" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Slug</Field.Label>
                  <Input name="slug" placeholder="read" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="Read Access" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input name="description" placeholder="Optional description" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Entitlement"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Create Resource Dialog */}
      <Dialog.Root open={resourceDialogOpen} onOpenChange={setResourceDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>Create Resource</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setResourceDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createResource" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Resource Type</Field.Label>
                  <Input name="resourceType" placeholder="folder" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Display Name</Field.Label>
                  <Input name="displayName" placeholder="Documents" required />
                </Field.Root>
                <Field.Root>
                  <Field.Label>External ID</Field.Label>
                  <Input name="externalId" placeholder="Optional external identifier" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Path</Field.Label>
                  <Input name="path" placeholder="/documents" />
                </Field.Root>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Resource"}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  )
}

/** Reusable table renderer for any TanStack table instance */
function DataTable<T>({ table }: { table: ReturnType<typeof useReactTable<T>> }) {
  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport>
        <ScrollArea.Content>
          <Table.Root>
            <Table.Header>
              {table.getHeaderGroups().map((headerGroup) => (
                <Table.Row key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <Table.HeaderCell key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
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
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb orientation="horizontal" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}

const styles = css.create({
  tabContent: {
    paddingTop: spacing.md,
  },
})
