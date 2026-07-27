import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/settings.activity"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { loadUserAccess, loadUserActivity, type AccessRow } from "~/lib/settings/user-activity.server"
import { Badge, Inline, Stack, Tag, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { enumLabel } from "~/lib/enum-labels"
import { useDisplayFormat } from "~/hooks/useDisplayFormat"

export function meta() {
  return [{ title: "Activity - Duro settings" }]
}

interface ActivityEntry {
  id: string
  eventType: string
  actorName: string | null
  targetName: string | null
  applicationName: string | null
  createdAt: string
  /** Whether the signed-in user performed the action (vs. was its target). */
  byMe: boolean
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)

  // The principal is lazy-created on first login; a user authenticated at the
  // IdP but never synced simply has no activity yet — render quiet empties.
  const data = await runEffect(
    Effect.gen(function* () {
      const principals = yield* PrincipalRepo
      const principal = auth.sub ? yield* principals.findByExternalId(auth.sub) : null
      if (!principal) return { events: [], access: [] as AccessRow[], groups: [] as string[] }
      const [events, access, groups] = yield* Effect.all([
        loadUserActivity(principal.id),
        loadUserAccess(principal.id),
        principals.listGroupsFor(principal.id).pipe(
          Effect.map((gs) => gs.map((g) => g.displayName)),
          Effect.catchAll(() => Effect.succeed([] as string[])),
        ),
      ])
      return { principalId: principal.id, events, access, groups }
    }),
  ).catch(() => ({ principalId: undefined, events: [], access: [] as AccessRow[], groups: [] as string[] }))

  const events: ActivityEntry[] = data.events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    actorName: e.actorName,
    targetName: e.targetName,
    applicationName: e.applicationName,
    createdAt: new Date(e.createdAt as string | Date).toISOString(),
    byMe: e.actorId === ("principalId" in data ? data.principalId : undefined),
  }))

  // Fall back to the live OIDC session groups when governance has none yet.
  const groups = data.groups.length > 0 ? data.groups : auth.groups

  return { events, access: data.access, groups }
}

export default function ActivitySettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { formatDateTime, formatDate } = useDisplayFormat()
  const { events, access, groups } = loaderData

  return (
    <Stack gap="lg">
      <CardSection title={t("settings.activity.recentTitle")}>
        <Stack gap="sm">
          <Text color="muted" variant="caption">
            {t("settings.activity.recentHint")}
          </Text>
          {events.length === 0 ? (
            <Text color="muted">{t("settings.activity.recentEmpty")}</Text>
          ) : (
            events.map((e) => (
              <Inline key={e.id} justify="between" align="center">
                <Inline gap="sm" align="center">
                  <Badge size="sm">{enumLabel(t, "eventType", e.eventType)}</Badge>
                  <Text>
                    {e.byMe ? (e.targetName ?? e.applicationName ?? t("settings.activity.you")) : (e.actorName ?? "—")}
                  </Text>
                </Inline>
                <Text color="muted" variant="caption">
                  {formatDateTime(e.createdAt)}
                </Text>
              </Inline>
            ))
          )}
        </Stack>
      </CardSection>

      <CardSection title={t("settings.activity.accessTitle")}>
        {access.length === 0 ? (
          <Text color="muted">{t("settings.activity.accessEmpty")}</Text>
        ) : (
          <Stack gap="sm">
            {access.map((g) => (
              <Inline key={g.id} justify="between" align="center">
                <Stack gap="xs">
                  <Text>{[g.what, g.app].filter(Boolean).join(" · ") || "—"}</Text>
                  {g.reason && (
                    <Text color="muted" variant="caption">
                      {t("settings.activity.accessReason", { reason: g.reason })}
                    </Text>
                  )}
                </Stack>
                <Text color="muted" variant="caption">
                  {g.expiresAt
                    ? t("settings.activity.accessExpires", { date: formatDate(g.expiresAt) })
                    : t("settings.activity.accessGrantedOn", { date: formatDate(g.grantedAt) })}
                </Text>
              </Inline>
            ))}
          </Stack>
        )}
      </CardSection>

      <CardSection title={t("settings.activity.groupsTitle")}>
        {groups.length === 0 ? (
          <Text color="muted">{t("settings.activity.groupsEmpty")}</Text>
        ) : (
          <Inline gap="sm" align="center">
            {groups.map((g) => (
              <Tag key={g}>{g}</Tag>
            ))}
          </Inline>
        )}
      </CardSection>
    </Stack>
  )
}
