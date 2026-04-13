import { Effect } from "effect"
import { useNavigate } from "react-router"
import { runEffect } from "~/lib/runtime.server"
import { PluginRegistry } from "~/lib/plugins/PluginRegistry.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import type { PluginAction, PluginManifest } from "~/lib/plugins/contracts"
import { Badge, Heading, Inline, ScrollArea, Stack, Table, Tag, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { css, html } from "react-strict-dom"

interface PluginRow {
  manifest: PluginManifest
  installCount: number
}

export async function loader() {
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

const styles = css.create({
  clickableRow: { cursor: "pointer" },
  displayContents: { display: "contents" },
})

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
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <ScrollArea.Content>
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
                    <html.div
                      key={p.manifest.slug}
                      onClick={() => navigate(`/admin/plugins/${p.manifest.slug}`)}
                      style={[styles.clickableRow, styles.displayContents]}
                    >
                      <Table.Row>
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
                          <Inline gap="xs">
                            {p.manifest.capabilities.map((cap: string) => (
                              <Tag key={cap} size="sm">
                                {cap}
                              </Tag>
                            ))}
                          </Inline>
                        </Table.Cell>
                        <Table.Cell>
                          <Text>{p.installCount}</Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text>{p.manifest.timeoutMs / 1000}s</Text>
                        </Table.Cell>
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
      </CardSection>
    </Stack>
  )
}
