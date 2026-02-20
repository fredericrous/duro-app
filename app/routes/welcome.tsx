import { useTranslation } from "react-i18next"
import type { Route } from "./+types/welcome"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { ButtonLink } from "~/components/ButtonLink/ButtonLink"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { StatusIcon } from "~/components/StatusIcon/StatusIcon"
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
      <StatusIcon name="check-circle" size={64} variant="success" className={styles.bigIcon} />

      <h1>{t("welcome.heading", { user })}</h1>
      <p className={styles.message}>{t("welcome.message")}</p>

      <ButtonLink to="/">{t("welcome.cta")}</ButtonLink>
    </CenteredCardPage>
  )
}
