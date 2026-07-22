import { useTranslation } from "react-i18next"
import { redirect } from "react-router"
import type { Route } from "./+types/settings.security"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { LinkButton, Stack, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export function meta() {
  return [{ title: "Security - Duro settings" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuth(request)
  // No portal configured → this section doesn't exist; send them back to General.
  if (!config.autheliaUrl) throw redirect("/settings")
  return { autheliaUrl: config.autheliaUrl }
}

export default function SecuritySettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  return (
    <CardSection title={t("settings.security.heading")}>
      <Stack gap="sm">
        <Text as="p" color="muted" variant="bodySm">
          {t("settings.security.description")}
        </Text>
        <LinkButton href={loaderData.autheliaUrl} target="_blank" rel="noopener noreferrer" variant="secondary">
          {t("settings.security.openPortal")}
        </LinkButton>
        <Text as="p" color="muted" variant="bodySm">
          {t("settings.security.managedBy")}
        </Text>
      </Stack>
    </CardSection>
  )
}
