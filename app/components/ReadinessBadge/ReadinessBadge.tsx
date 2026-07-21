import { useTranslation } from "react-i18next"
import { Badge, Tooltip } from "@duro-app/ui"
import { applicationReadiness, READINESS_TONE, type ReadinessSignals } from "~/lib/app-readiness"

/**
 * Named application maturity level (Draft → Configured → Grantable →
 * Provisioned) as a toned badge, with a tooltip explaining what the level
 * means. Used on the app detail page and the applications list.
 */
export function ReadinessBadge({ signals }: { signals: ReadinessSignals }) {
  const { t } = useTranslation()
  const level = applicationReadiness(signals)
  return (
    <Tooltip.Root content={t(`admin.applications.readiness.desc.${level}`)} placement="top">
      <Tooltip.Trigger>
        <Badge variant={READINESS_TONE[level]}>{t(`admin.applications.readiness.level.${level}`)}</Badge>
      </Tooltip.Trigger>
    </Tooltip.Root>
  )
}
