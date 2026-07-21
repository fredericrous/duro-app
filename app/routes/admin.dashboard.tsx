import { useNavigate, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import type { Route } from "./+types/admin.dashboard"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { Heading, Inline, LinkButton, Panel, Stack, Text } from "@duro-app/ui"
import { SetupCompleteness, type SetupCriterion } from "~/components/AppOverview/SetupCompleteness"
import { GovernanceHygiene, type HygieneFinding } from "~/components/GovernanceHygiene/GovernanceHygiene"

export function meta() {
  return [{ title: "Admin overview - Duro" }]
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
    }),
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
    }),
  ).catch(() => ({ appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 }))

  return { setup, hygiene }
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setup, hygiene } = loaderData
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
  ]

  const awaiting = [
    { key: "accessRequests", count: pending.accessRequests, to: "/admin/access-requests" },
    { key: "invitations", count: pending.accessInvitations, to: "/admin/invitations" },
  ].filter((a) => a.count > 0)

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
    </Stack>
  )
}
