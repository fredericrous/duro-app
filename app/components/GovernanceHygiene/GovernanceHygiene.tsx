import { useTranslation } from "react-i18next"
import { css, html } from "react-strict-dom"
import { Button, Heading, Icon, Inline, Panel, Stack, Text } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"

export interface HygieneFinding {
  /** stable id → admin.hygiene.findings.<id> (pluralized, {{count}}) + fix.<id> */
  id: string
  count: number
  onFix: () => void
}

/**
 * Admin governance-health surface. Lists real, actionable misconfigurations
 * (apps with no owner, ungrantable apps, expired invitations) with a one-click
 * jump to where each is fixed — so the admin can see and finish outstanding
 * work. Deliberately NOT gamified: findings that are clear simply drop off, and
 * "all clear" is a quiet muted line, not a celebration.
 */
export function GovernanceHygiene({ findings }: { findings: ReadonlyArray<HygieneFinding> }) {
  const { t } = useTranslation()
  const active = findings.filter((f) => f.count > 0)

  return (
    <Panel.Root bordered>
      <Panel.Header>
        <Heading level={4}>{t("admin.hygiene.title")}</Heading>
      </Panel.Header>
      <Panel.Body>
        {active.length === 0 ? (
          <Inline gap="sm" align="center">
            <html.span style={[styles.icon, styles.ok]}>
              <Icon name="check-circle" size={18} />
            </html.span>
            <Text color="muted">{t("admin.hygiene.allClear")}</Text>
          </Inline>
        ) : (
          <Stack gap="sm">
            {active.map((f) => (
              <Inline key={f.id} justify="between" align="center">
                <Inline gap="sm" align="center">
                  <html.span style={[styles.icon, styles.warn]}>
                    <Icon name="alert-triangle" size={18} />
                  </html.span>
                  <Text>{t(`admin.hygiene.findings.${f.id}`, { count: f.count })}</Text>
                </Inline>
                <Button variant="secondary" size="small" onClick={f.onFix}>
                  {t(`admin.hygiene.fix.${f.id}`)}
                </Button>
              </Inline>
            ))}
          </Stack>
        )}
      </Panel.Body>
    </Panel.Root>
  )
}

const styles = css.create({
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ok: { color: colors.success },
  warn: { color: colors.warning },
})
