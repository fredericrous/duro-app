import { useNavigate, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import type { Route } from "./+types/admin.dashboard"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import {
  loadExpiringSoon,
  loadGlanceStats,
  loadHygieneExtras,
  loadRecentActivity,
  type ExpiringItem,
  type GlanceStats,
} from "~/lib/governance/dashboard-stats.server"
import { Heading, Inline, LinkButton, Panel, Stack, Text } from "@duro-app/ui"
import { SetupCompleteness, type SetupCriterion } from "~/components/AppOverview/SetupCompleteness"
import { GovernanceHygiene, type HygieneFinding } from "~/components/GovernanceHygiene/GovernanceHygiene"
import { StatGrid } from "~/components/AppOverview/StatGrid"
import { ExpiringSoon } from "~/components/admin/ExpiringSoon"
import { RecentActivity, type ActivityRow } from "~/components/admin/RecentActivity"

export function meta() {
  return [{ title: "Admin overview - Duro" }]
}

const EMPTY_GLANCE: GlanceStats = {
  people: 0,
  serviceAccounts: 0,
  applicationsEnabled: 0,
  applicationsTotal: 0,
  activeGrants: 0,
  activeApiKeys: 0,
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  // First-run milestones (has the instance an app / grant / invitation ever?).
  const setup = await runEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [apps, grants, invites] = yield* Effect.all([
        sql`SELECT EXISTS(SELECT 1 FROM applications) AS x`,
        sql`SELECT EXISTS(SELECT 1 FROM grants) AS x`,
        sql`SELECT EXISTS(SELECT 1 FROM access_invitations) AS x`,
      ])
      const has = (r: readonly unknown[]) => Boolean((r[0] as { x?: boolean } | undefined)?.x)
      return { hasApp: has(apps), hasGrant: has(grants), hasInvite: has(invites) }
    }).pipe(Effect.orDie), // rejection handled by .catch below
  ).catch(() => ({ hasApp: true, hasGrant: true, hasInvite: true }))

  // Governance-health gaps an admin should clear.
  const hygiene = await runEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [noOwner, noRole, staleInv] = yield* Effect.all([
        sql`SELECT count(*)::int AS n FROM applications WHERE owner_id IS NULL`,
        sql`SELECT count(*)::int AS n FROM applications a
            WHERE a.enabled = true AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.application_id = a.id)`,
        sql`SELECT count(*)::int AS n FROM access_invitations
            WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()`,
      ])
      const n = (r: readonly unknown[]) => ((r[0] as { n?: number } | undefined)?.n ?? 0) as number
      return { appsWithoutOwner: n(noOwner), enabledAppsWithoutRole: n(noRole), staleInvitations: n(staleInv) }
    }).pipe(Effect.orDie), // rejection handled by .catch below
  ).catch(() => ({ appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 }))

  // Estate data. Each aggregate degrades independently — a failing panel
  // renders empty, never breaks the page.
  const [glance, expiring, activity, hygieneExtras] = await Promise.all([
    runEffect(loadGlanceStats.pipe(Effect.orDie)).catch(() => EMPTY_GLANCE),
    runEffect(loadExpiringSoon().pipe(Effect.orDie)).catch(() => [] as ExpiringItem[]),
    runEffect(loadRecentActivity().pipe(Effect.orDie)).catch(() => []),
    runEffect(loadHygieneExtras.pipe(Effect.orDie)).catch(() => ({
      failedProvisioningJobs: 0,
      connectorsWithErrors: 0,
    })),
  ])

  // Keep the loader payload lean: the feed only needs display fields.
  const recentActivity: ActivityRow[] = activity.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    actorName: e.actorName,
    targetName: e.targetName,
    applicationName: e.applicationName,
    createdAt: new Date(e.createdAt as string | Date).toISOString(),
  }))

  return { setup, hygiene, glance, expiring, recentActivity, hygieneExtras }
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setup, hygiene, glance, expiring, recentActivity, hygieneExtras } = loaderData
  // Pending counts are already loaded (and 45s-refreshed) by the admin layout;
  // reuse them for the "awaiting review" summary instead of a second query.
  const parent = useRouteLoaderData("routes/admin") as
    | { pendingCounts?: { accessRequests: number; accessInvitations: number } }
    | undefined
  const pending = parent?.pendingCounts ?? { accessRequests: 0, accessInvitations: 0 }

  const setupComplete = setup.hasApp && setup.hasGrant && setup.hasInvite
  const firstRunCriteria: SetupCriterion[] = [
    { id: "firstApp", done: setup.hasApp, onFix: () => navigate("/admin/applications") },
    { id: "firstGrant", done: setup.hasGrant, onFix: () => navigate("/admin/grants/new") },
    { id: "firstInvite", done: setup.hasInvite, onFix: () => navigate("/admin/invitations") },
  ]
  const hygieneFindings: HygieneFinding[] = [
    { id: "apps_without_owner", count: hygiene.appsWithoutOwner, onFix: () => navigate("/admin/applications") },
    {
      id: "enabled_apps_without_role",
      count: hygiene.enabledAppsWithoutRole,
      onFix: () => navigate("/admin/applications"),
    },
    { id: "stale_invitations", count: hygiene.staleInvitations, onFix: () => navigate("/admin/invitations") },
    { id: "failed_provisioning", count: hygieneExtras.failedProvisioningJobs, onFix: () => navigate("/admin/plugins") },
    {
      id: "connectors_with_errors",
      count: hygieneExtras.connectorsWithErrors,
      onFix: () => navigate("/admin/plugins"),
    },
  ]

  const awaiting = [
    { key: "accessRequests", count: pending.accessRequests, to: "/admin/access-requests" },
    { key: "invitations", count: pending.accessInvitations, to: "/admin/invitations" },
  ].filter((a) => a.count > 0)

  const stats = [
    {
      label: t("admin.dashboard.glance.people"),
      value: glance.people,
      hint: t("admin.dashboard.glance.peopleHint", { count: glance.serviceAccounts }),
    },
    {
      label: t("admin.dashboard.glance.applications"),
      value: glance.applicationsEnabled,
      hint: t("admin.dashboard.glance.applicationsHint", {
        enabled: glance.applicationsEnabled,
        total: glance.applicationsTotal,
      }),
    },
    { label: t("admin.dashboard.glance.activeGrants"), value: glance.activeGrants },
    { label: t("admin.dashboard.glance.apiKeys"), value: glance.activeApiKeys },
  ]

  return (
    <Stack gap="lg">
      <Heading level={2}>{t("admin.dashboard.title")}</Heading>

      {!setupComplete && <SetupCompleteness criteria={firstRunCriteria} i18nPrefix="admin.firstRun" />}

      <Panel.Root bordered>
        <Panel.Header>
          <Heading level={4}>{t("admin.dashboard.awaiting.title")}</Heading>
        </Panel.Header>
        <Panel.Body>
          {awaiting.length === 0 ? (
            <Text color="muted">{t("admin.dashboard.awaiting.allClear")}</Text>
          ) : (
            <Stack gap="sm">
              {awaiting.map((a) => (
                <Inline key={a.key} justify="between" align="center">
                  <Text>{t(`admin.dashboard.awaiting.${a.key}`, { count: a.count })}</Text>
                  <LinkButton href={a.to} variant="secondary">
                    {t("admin.dashboard.awaiting.review")}
                  </LinkButton>
                </Inline>
              ))}
            </Stack>
          )}
        </Panel.Body>
      </Panel.Root>

      <GovernanceHygiene findings={hygieneFindings} />

      <StatGrid stats={stats} />

      <ExpiringSoon items={expiring} />

      <RecentActivity events={recentActivity} />
    </Stack>
  )
}
