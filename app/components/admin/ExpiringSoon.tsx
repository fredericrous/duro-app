import { useTranslation } from "react-i18next"
import { Badge, Heading, Inline, LinkButton, Panel, Stack, Text } from "@duro-app/ui"
import type { ExpiringItem } from "~/lib/governance/dashboard-stats.server"

const KIND_LINK: Record<ExpiringItem["kind"], string> = {
  grant: "/admin/grants",
  certificate: "/admin/identities",
  apiKey: "/admin/identities",
  invitation: "/admin/invitations",
}

const KIND_TONE: Record<ExpiringItem["kind"], "info" | "warning" | "default"> = {
  grant: "warning",
  certificate: "info",
  apiKey: "default",
  invitation: "info",
}

/** Whole days until an ISO deadline, floored at 0 (expires today). */
function daysUntil(expiresAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000))
}

/**
 * Admin dashboard "time bomb" panel: everything with a deadline in the next
 * 30 days (grants, device certificates, API keys, pending invitations),
 * soonest first, each with a jump to where it's handled. Empty state is a
 * quiet muted line — same tone as GovernanceHygiene, no celebration.
 */
export function ExpiringSoon({ items }: { items: ReadonlyArray<ExpiringItem> }) {
  const { t } = useTranslation()
  // One `now` per render keeps the day math consistent across rows.
  const now = new Date()

  return (
    <Panel.Root bordered>
      <Panel.Header>
        <Heading level={4}>{t("admin.dashboard.expiring.title")}</Heading>
      </Panel.Header>
      <Panel.Body>
        {items.length === 0 ? (
          <Text color="muted">{t("admin.dashboard.expiring.empty")}</Text>
        ) : (
          <Stack gap="sm">
            {items.map((item, i) => {
              const days = daysUntil(item.expiresAt, now)
              return (
                <Inline key={`${item.kind}-${item.label}-${i}`} justify="between" align="center">
                  <Inline gap="sm" align="center">
                    <Badge variant={KIND_TONE[item.kind]} size="sm">
                      {t(`admin.dashboard.expiring.kind.${item.kind}`)}
                    </Badge>
                    <Text>{item.label || "—"}</Text>
                    <Text color="muted" variant="caption">
                      {days === 0
                        ? t("admin.dashboard.expiring.today")
                        : t("admin.dashboard.expiring.inDays", { count: days })}
                    </Text>
                  </Inline>
                  <LinkButton href={KIND_LINK[item.kind]} variant="secondary">
                    {t("admin.dashboard.expiring.review")}
                  </LinkButton>
                </Inline>
              )
            })}
          </Stack>
        )}
      </Panel.Body>
    </Panel.Root>
  )
}
