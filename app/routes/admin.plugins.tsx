import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { PluginRegistry } from "~/lib/plugins/PluginRegistry.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import type { PluginAction, PluginManifest } from "~/lib/plugins/contracts"
import {
  Badge,
  Heading,
  Inline,
  ScrollArea,
  Stack,
  Table,
  Tag,
  Text,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

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

      const rows: PluginRow[] = []
      for (const m of manifests) {
        const installs = yield* systems.listByApplication("").pipe(
          Effect.catchAll(() => Effect.succeed([])),
        )
        const count = installs.filter(
          (s) => s.connectorType === "plugin" && s.pluginSlug === m.slug,
        ).length

        rows.push({ manifest: m, installCount: count })
      }

      return rows
    }),
  )

  return { plugins: data }
}

export default function AdminPluginsPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { plugins } = loaderData

  return (
    <Stack gap="md">
      <Heading level={2}>Provisioning Plugins</Heading>
      <Text color="muted">
        Registered plugins that handle grant provisioning to external systems.
        Each plugin declares its capabilities and permission strategy.
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
                    <Table.Row key={p.manifest.slug}>
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

      {plugins.map((p: PluginRow) => (
        <CardSection key={p.manifest.slug} title={`${p.manifest.displayName} — Permission Strategy`}>
          <Stack gap="sm">
            <Text color="muted">{p.manifest.description}</Text>
            {Object.entries(p.manifest.permissionStrategy.byRoleSlug).map(([roleSlug, actions]: [string, readonly PluginAction[]]) => (
              <Inline key={roleSlug} gap="sm" align="center">
                <Badge variant="info">{roleSlug}</Badge>
                <Text>{"\u2192"}</Text>
                <Text>
                  {actions.map((a: PluginAction) => `${a.op}(${"group" in a ? a.group : "url" in a ? a.url : ""})`).join(", ")}
                </Text>
              </Inline>
            ))}
            {p.manifest.vaultSecrets.length > 0 && (
              <Text color="muted">
                Vault secrets: {p.manifest.vaultSecrets.join(", ")}
              </Text>
            )}
            {p.manifest.allowedDomains.length > 0 && (
              <Text color="muted">
                Allowed domains: {p.manifest.allowedDomains.join(", ")}
              </Text>
            )}
          </Stack>
        </CardSection>
      ))}
    </Stack>
  )
}
