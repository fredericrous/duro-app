import { useFetcher } from "react-router"
import { css, html } from "react-strict-dom"
import { Badge, Button, Callout, Heading, Inline, Panel, Stack, Text } from "@duro-app/ui"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { hasStarterTemplate } from "~/lib/governance/defaultRbac"
import type { Application, Entitlement, Grant, Role } from "~/lib/governance/types"
import { StatGrid, type Stat } from "./StatGrid"

interface AppOverviewProps {
  application: Application
  roles: ReadonlyArray<Role>
  entitlements: ReadonlyArray<Entitlement>
  grants: ReadonlyArray<Grant>
  pluginInfo: { pluginSlug: string; pluginVersion: string } | null
  onOpenQuickGrant: () => void
  onSwitchTab: (tab: string) => void
}

const styles = css.create({
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: spacing.lg,
    rowGap: spacing.sm,
    padding: spacing.md,
  },
  headerRow: {
    width: "100%",
  },
})

export function AppOverview({
  application,
  roles,
  entitlements,
  grants,
  pluginInfo,
  onOpenQuickGrant,
  onSwitchTab,
}: AppOverviewProps) {
  const syncFetcher = useFetcher()
  const isSyncing = syncFetcher.state !== "idle"

  const principalCount = new Set(grants.map((g) => g.principalId)).size
  const activeGrantCount = grants.length // findActiveForApp already filters

  const stats: Stat[] = [
    { label: "Principals with access", value: principalCount },
    { label: "Active grants", value: activeGrantCount },
    { label: "Roles", value: roles.length },
    { label: "Last sync", value: formatLastSync(application.lastSyncedAt) },
  ]

  const showStarterCallout = hasStarterTemplate(
    roles.map((r) => r.slug),
    entitlements.map((e) => e.slug),
  )

  return (
    <Stack gap="md">
      <html.div style={styles.headerRow}>
        <Inline justify="between" align="center">
          <Inline gap="sm" align="center">
            <Heading level={3}>{application.displayName}</Heading>
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
            </Badge>
            <Badge variant={application.enabled ? "success" : "default"}>
              {application.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </Inline>
          <Button variant="primary" onClick={onOpenQuickGrant}>
            Grant access
          </Button>
        </Inline>
      </html.div>

      <StatGrid stats={stats} />

      {showStarterCallout && (
        <Callout variant="info">
          <Text>
            Starter roles created from the default template. These are placeholder labels — review entitlements before
            granting production access. Auto-detection from Kubernetes RBAC is not yet wired up.
          </Text>
        </Callout>
      )}

      <Panel.Root bordered>
        <Panel.Header>
          <Heading level={4}>Application details</Heading>
        </Panel.Header>
        <Panel.Body padded={false}>
          <html.div style={styles.detailsGrid}>
            <Text color="muted">Slug</Text>
            <Text>{application.slug}</Text>

            <Text color="muted">Owner</Text>
            <Text>{application.ownerId ?? "—"}</Text>

            <Text color="muted">Description</Text>
            <Text>{application.description ?? "—"}</Text>

            <Text color="muted">Provisioning</Text>
            <Text>
              {pluginInfo
                ? `${pluginInfo.pluginSlug} v${pluginInfo.pluginVersion}`
                : "None (grants are governance-only)"}
            </Text>
          </html.div>
        </Panel.Body>
      </Panel.Root>

      <Inline gap="sm">
        <syncFetcher.Form method="post">
          <input type="hidden" name="intent" value="syncNow" />
          <Button type="submit" variant="secondary" disabled={isSyncing}>
            {isSyncing ? "Syncing…" : "Sync now"}
          </Button>
        </syncFetcher.Form>
        <Button variant="secondary" onClick={() => onSwitchTab("settings")}>
          Edit settings
        </Button>
        <a href={`/admin/audit?applicationId=${application.id}`}>
          <Button variant="secondary">View audit log</Button>
        </a>
      </Inline>

      {syncFetcher.data && "message" in syncFetcher.data && (
        <Callout variant="success">
          <Text>{String(syncFetcher.data.message)}</Text>
        </Callout>
      )}
      {syncFetcher.data && "error" in syncFetcher.data && (
        <Callout variant="error">
          <Text>{String(syncFetcher.data.error)}</Text>
        </Callout>
      )}
    </Stack>
  )
}

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "Never"
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 60) return "just now"
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}
