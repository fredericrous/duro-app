import { useTranslation } from "react-i18next"
import { Badge, Heading, Inline, LinkButton, Panel, Stack, Text } from "@duro-app/ui"
import { enumLabel } from "~/lib/enum-labels"
import { useDisplayFormat } from "~/hooks/useDisplayFormat"

export interface ActivityRow {
  id: string
  eventType: string
  actorName: string | null
  targetName: string | null
  applicationName: string | null
  createdAt: string | Date
}

/**
 * Admin dashboard "what happened while I was away" feed: the last few audit
 * events, name-enriched, with a link to the full filtered audit log.
 */
export function RecentActivity({ events }: { events: ReadonlyArray<ActivityRow> }) {
  const { t } = useTranslation()
  const { formatDateTime } = useDisplayFormat()

  return (
    <Panel.Root bordered>
      <Panel.Header>
        <Inline justify="between" align="center">
          <Heading level={4}>{t("admin.dashboard.activity.title")}</Heading>
          <LinkButton href="/admin/audit" variant="secondary">
            {t("admin.dashboard.activity.viewAll")}
          </LinkButton>
        </Inline>
      </Panel.Header>
      <Panel.Body>
        {events.length === 0 ? (
          <Text color="muted">{t("admin.dashboard.activity.empty")}</Text>
        ) : (
          <Stack gap="sm">
            {events.map((e) => (
              <Inline key={e.id} justify="between" align="center">
                <Inline gap="sm" align="center">
                  <Badge size="sm">{enumLabel(t, "eventType", e.eventType)}</Badge>
                  <Text>{[e.actorName, e.targetName ?? e.applicationName].filter(Boolean).join(" · ") || "—"}</Text>
                </Inline>
                <Text color="muted" variant="caption">
                  {formatDateTime(e.createdAt)}
                </Text>
              </Inline>
            ))}
          </Stack>
        )}
      </Panel.Body>
    </Panel.Root>
  )
}
