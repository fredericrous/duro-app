import { useState } from "react"
import type { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Button, Heading, Stack, StatusIcon, Text } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import { RequestAccessForm } from "~/components/RequestAccessForm/RequestAccessForm"
import type { AppCatalogEntry } from "~/lib/apps-catalog.server"

const styles = css.create({
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: 32,
  },
  icon: {
    marginBottom: 24,
  },
  ctaWrap: {
    width: "100%",
    maxWidth: 360,
  },
})

interface NoAccessProps {
  user: string | null
  /** Catalog entries to surface in the request form. */
  requestableApps?: ReadonlyArray<AppCatalogEntry>
  fetcher?: ReturnType<typeof useFetcher>
}

export function NoAccess({ user, requestableApps = [], fetcher }: NoAccessProps) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)

  const canRequest = requestableApps.length > 0 && fetcher !== undefined

  return (
    <html.div style={styles.container}>
      <html.div style={styles.icon}>
        <StatusIcon name="forbidden" size={64} variant="error" />
      </html.div>
      <Stack gap="sm" align="center">
        <Heading level={1}>{t("noAccess.title")}</Heading>
        <Text variant="bodyLg" color="muted" as="p">
          {user ? t("noAccess.messageUser", { user }) : t("noAccess.messageAnon")}
        </Text>
        <Text variant="bodySm" color="muted" as="p">
          {t("noAccess.hint")}
        </Text>
      </Stack>

      {canRequest && !showForm && (
        <html.div style={styles.ctaWrap}>
          <Stack gap="md">
            <Button variant="primary" onClick={() => setShowForm(true)}>
              {t("noAccess.requestCta")}
            </Button>
          </Stack>
        </html.div>
      )}

      {canRequest && showForm && fetcher && (
        <RequestAccessForm apps={requestableApps} fetcher={fetcher} onCancel={() => setShowForm(false)} />
      )}
    </html.div>
  )
}
