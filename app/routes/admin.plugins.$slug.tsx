import { Effect } from "effect"
import { useNavigate } from "react-router"
import { runEffect } from "~/lib/runtime.server"
import { PluginRegistry } from "~/lib/plugins/PluginRegistry.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import type { PluginAction, PluginManifest } from "~/lib/plugins/contracts"
import type { AuditEvent, Application, ConnectedSystem } from "~/lib/governance/types"
import { Badge, Button, Heading, Inline, Panel, ScrollArea, Stack, Table, Tag, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"

interface LoaderData {
  manifest: PluginManifest
  installs: Array<{ system: ConnectedSystem; applicationSlug: string; applicationName: string }>
  recentEvents: AuditEvent[]
}

export async function loader({ params }: { params: { slug: string } }) {
  const slug = params.slug

  const data = await runEffect(
    Effect.gen(function* () {
      const registry = yield* PluginRegistry
      const systems = yield* ConnectedSystemRepo
      const appRepo = yield* ApplicationRepo
      const audit = yield* AuditService

      const plugin = yield* registry.get(slug)

      const allApps = yield* appRepo.list()
      const appMap = new Map(allApps.map((a) => [a.id, a]))

      const installs: LoaderData["installs"] = []
      for (const app of allApps) {
        const sys = yield* systems.findByApplicationAndPlugin(app.id, slug)
        if (sys) {
          installs.push({
            system: sys,
            applicationSlug: app.slug,
            applicationName: app.displayName,
          })
        }
      }

      const recentEvents = yield* audit.query({ eventType: undefined, limit: 20 }).pipe(
        Effect.map((events) =>
          events.filter(
            (e) =>
              e.metadata && typeof e.metadata === "object" && (e.metadata as Record<string, unknown>).plugin === slug,
          ),
        ),
        Effect.catchAll(() => Effect.succeed([] as AuditEvent[])),
      )

      return { manifest: plugin.manifest, installs, recentEvents } satisfies LoaderData
    }),
  )

  return data
}

const styles = css.create({
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: spacing.lg,
    rowGap: spacing.sm,
    padding: spacing.md,
  },
})

export default function AdminPluginDetailPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { manifest, installs, recentEvents } = loaderData
  const navigate = useNavigate()

  return (
    <Stack gap="md">
      <Inline justify="between" align="center">
        <Stack gap="xs">
          <Heading level={2}>{manifest.displayName}</Heading>
          <Inline gap="sm">
            <Badge variant="default">{manifest.slug}</Badge>
            <Badge variant="default">v{manifest.version}</Badge>
            <Badge variant={manifest.imperative ? "warning" : "success"}>
              {manifest.imperative ? "Imperative" : "Declarative"}
            </Badge>
          </Inline>
        </Stack>
        <Button variant="secondary" onClick={() => navigate("/admin/plugins")}>
          Back to plugins
        </Button>
      </Inline>

      <Text>{manifest.description}</Text>

      <Panel.Root bordered>
        <Panel.Header>
          <Heading level={4}>Manifest</Heading>
        </Panel.Header>
        <Panel.Body padded={false}>
          <html.div style={styles.detailsGrid}>
            <Text color="muted">Capabilities</Text>
            <Inline gap="xs">
              {manifest.capabilities.map((cap: string) => (
                <Tag key={cap} size="sm">
                  {cap}
                </Tag>
              ))}
            </Inline>

            <Text color="muted">Allowed domains</Text>
            <Text>{manifest.allowedDomains.length > 0 ? manifest.allowedDomains.join(", ") : "None"}</Text>

            <Text color="muted">Vault secrets</Text>
            <Text>{manifest.vaultSecrets.length > 0 ? manifest.vaultSecrets.join(", ") : "None"}</Text>

            <Text color="muted">Timeout</Text>
            <Text>{manifest.timeoutMs / 1000}s</Text>

            <Text color="muted">LLDAP group patterns</Text>
            <Text>{manifest.ownedLldapGroups.length > 0 ? manifest.ownedLldapGroups.join(", ") : "None"}</Text>
          </html.div>
        </Panel.Body>
      </Panel.Root>

      {Object.keys(manifest.permissionStrategy.byRoleSlug).length > 0 && (
        <CardSection title="Permission Strategy">
          <Stack gap="sm">
            {Object.entries(manifest.permissionStrategy.byRoleSlug).map(
              ([roleSlug, actions]: [string, readonly PluginAction[]]) => (
                <Inline key={roleSlug} gap="sm" align="center">
                  <Badge variant="info">{roleSlug}</Badge>
                  <Text>{"\u2192"}</Text>
                  <Text>
                    {actions
                      .map((a: PluginAction) => `${a.op}(${"group" in a ? a.group : "url" in a ? a.url : ""})`)
                      .join(", ")}
                  </Text>
                </Inline>
              ),
            )}
          </Stack>
        </CardSection>
      )}

      <CardSection title={`Installed on (${installs.length} apps)`}>
        {installs.length === 0 ? (
          <Text color="muted">Not installed on any application yet.</Text>
        ) : (
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Application</Table.HeaderCell>
                      <Table.HeaderCell>Status</Table.HeaderCell>
                      <Table.HeaderCell>Version</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {installs.map((i) => (
                      <Table.Row key={i.system.id}>
                        <Table.Cell>
                          <Stack gap="xs">
                            <Text>{i.applicationName}</Text>
                            <Text color="muted" variant="caption">
                              {i.applicationSlug}
                            </Text>
                          </Stack>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge variant={i.system.status === "active" ? "success" : "default"}>
                            {i.system.status}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Text>{i.system.pluginVersion ?? "?"}</Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </ScrollArea.Content>
            </ScrollArea.Viewport>
          </ScrollArea.Root>
        )}
      </CardSection>

      <CardSection title={`Recent activity (${recentEvents.length})`}>
        {recentEvents.length === 0 ? (
          <Text color="muted">No recent plugin invocations.</Text>
        ) : (
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Event</Table.HeaderCell>
                      <Table.HeaderCell>Operation</Table.HeaderCell>
                      <Table.HeaderCell>Grant</Table.HeaderCell>
                      <Table.HeaderCell>Time</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {recentEvents.map((e) => {
                      const meta = (e.metadata ?? {}) as Record<string, unknown>
                      return (
                        <Table.Row key={e.id}>
                          <Table.Cell>
                            <Badge
                              variant={
                                e.eventType.includes("completed")
                                  ? "success"
                                  : e.eventType.includes("failed")
                                    ? "error"
                                    : e.eventType.includes("skipped")
                                      ? "warning"
                                      : "default"
                              }
                            >
                              {e.eventType.replace("plugin.action.", "")}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell>
                            <Text>{String(meta.operation ?? "—")}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text variant="caption">{e.targetId ?? "—"}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text variant="caption">{new Date(e.createdAt).toLocaleString()}</Text>
                          </Table.Cell>
                        </Table.Row>
                      )
                    })}
                  </Table.Body>
                </Table.Root>
              </ScrollArea.Content>
            </ScrollArea.Viewport>
          </ScrollArea.Root>
        )}
      </CardSection>

      <Inline gap="sm">
        <a href={`/admin/audit?source=plugin:${manifest.slug}`}>
          <Button variant="secondary">View full audit log</Button>
        </a>
      </Inline>
    </Stack>
  )
}
