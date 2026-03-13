import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/welcome"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { Button, Heading, StatusIcon, Text } from "@duro-app/ui"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import styles from "./welcome.module.css"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Welcome - ${data.appName}` : "Welcome" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  return { user: auth.user, appName: config.appName }
}

export default function WelcomePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { user } = loaderData

  return (
    <CenteredCardPage className={styles.centered}>
      <div className={styles.bigIcon}>
        <StatusIcon name="check-circle" size={64} variant="success" />
      </div>

      <Heading level={1}>{t("welcome.heading", { user })}</Heading>
      <Text color="muted" as="p">
        {t("welcome.message")}
      </Text>

      <Link to="/" className={styles.ctaLink}>
        <Button variant="primary">{t("welcome.cta")}</Button>
      </Link>
    </CenteredCardPage>
  )
}
