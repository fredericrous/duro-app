import { Effect } from "effect"
import { useNavigate } from "react-router"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { PluginRegistry } from "~/lib/plugins/PluginRegistry.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import type { PluginManifest } from "~/lib/plugins/contracts"
import { Badge, Heading, Stack, Table, Tag, Text } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { CardSection } from "~/components/CardSection/CardSection"

const styles = css.create({
  // Capabilities can be many tags; wrap them onto multiple lines instead of
  // letting Inline (row, no-wrap) overflow into the next column.
  capabilities: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
})

interface PluginRow {
  manifest: PluginManifest
  installCount: number
}

export async function loader({ request }: { request: Request }) {
  await requireAdmin(request)
  const data = await runEffect(
    Effect.gen(function* () {
      const registry = yield* PluginRegistry
      const systems = yield* ConnectedSystemRepo
      const manifests = yield* registry.list()
      const counts = yield* systems.countByPluginSlug()

      const countMap = new Map(counts.map((c) => [c.pluginSlug, c.count]))

      return manifests.map(
        (m): PluginRow => ({
          manifest: m,
          installCount: countMap.get(m.slug) ?? 0,
        }),
      )
    }),
  )

  return { plugins: data }
}

export default function AdminPluginsPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { plugins } = loaderData
  const navigate = useNavigate()

  return (
    <Stack gap="md">
      <Heading level={2}>Provisioning Plugins</Heading>
      <Text color="muted">
        Registered plugins that handle grant provisioning to external systems. Click a plugin for details and recent
        activity.
      </Text>

      <CardSection title={`Plugins (${plugins.length})`}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Plugin</Table.HeaderCell>
              <Table.HeaderCell>Version</Table.HeaderCell>
              <Table.HeaderCell>Mode</Table.HeaderCell>
              <Table.HeaderCell>Capabilities</Table.HeaderCell>
              <Table.HeaderCell>Installs</Table.HeaderCell>
              <Table.HeaderCell>Timeout</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {plugins.map((p: PluginRow) => (
              <Table.Row
                key={p.manifest.slug}
                onClick={() => navigate(`/admin/plugins/${p.manifest.slug}`)}
                aria-label={p.manifest.displayName}
              >
                <Table.Cell>
                  <Stack gap="xs">
                    <Text>{p.manifest.displayName}</Text>
                    <Text color="muted" variant="caption">
                      {p.manifest.slug}
                    </Text>
                  </Stack>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant="default">{p.manifest.version}</Badge>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant={p.manifest.imperative ? "warning" : "success"}>
                    {p.manifest.imperative ? "Imperative" : "Declarative"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <html.div style={styles.capabilities}>
                    {p.manifest.capabilities.map((cap: string) => (
                      <Tag key={cap} size="sm" wrap>
                        {cap}
                      </Tag>
                    ))}
                  </html.div>
                </Table.Cell>
                <Table.Cell>
                  <Text>{p.installCount}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text>{p.manifest.timeoutMs / 1000}s</Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </CardSection>
    </Stack>
  )
}
