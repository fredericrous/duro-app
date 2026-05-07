import { useMemo, useState } from "react"
import type { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Alert, Button, Combobox, Field, Heading, Inline, Stack, StatusIcon, Text, Textarea } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import type { Application } from "~/lib/governance/types"

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
  formWrap: {
    width: "100%",
    maxWidth: 360,
    textAlign: "left",
  },
})

interface NoAccessProps {
  user: string | null
  requestableApps?: ReadonlyArray<Application>
  fetcher?: ReturnType<typeof useFetcher>
}

export function NoAccess({ user, requestableApps = [], fetcher }: NoAccessProps) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)
  const [appId, setAppId] = useState("")
  const [justification, setJustification] = useState("")

  const labels = useMemo<Record<string, string>>(
    () => Object.fromEntries(requestableApps.map((a) => [a.id, `${a.displayName} (${a.slug})`])),
    [requestableApps],
  )

  const canRequest = requestableApps.length > 0 && fetcher !== undefined
  const isSubmitting = fetcher?.state !== "idle"
  const data = (fetcher?.data ?? null) as { success?: boolean; error?: string } | null
  const succeeded = Boolean(data?.success)
  const errorCode = data?.error

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

      {canRequest && !showForm && !succeeded && (
        <html.div style={styles.formWrap}>
          <Stack gap="md">
            <Button variant="primary" onClick={() => setShowForm(true)}>
              {t("noAccess.requestCta")}
            </Button>
          </Stack>
        </html.div>
      )}

      {canRequest && showForm && !succeeded && fetcher && (
        <html.div style={styles.formWrap}>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="requestAccess" />
            <input type="hidden" name="applicationId" value={appId} />
            <Stack gap="md">
              {errorCode && (
                <Alert variant="error">
                  {t(`noAccess.error.${errorCode}`, { defaultValue: t("noAccess.error.unknown") }) as string}
                </Alert>
              )}
              <Field.Root>
                <Field.Label>{t("noAccess.form.application")}</Field.Label>
                <Combobox.Root value={appId} onValueChange={(v) => setAppId(v ?? "")} initialLabels={labels}>
                  <Combobox.Input placeholder={t("noAccess.form.applicationPlaceholder")} />
                  <Combobox.Popup>
                    {requestableApps.map((a) => (
                      <Combobox.Item key={a.id} value={a.id}>
                        {labels[a.id]}
                      </Combobox.Item>
                    ))}
                    <Combobox.Empty>{t("noAccess.form.noResults")}</Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("noAccess.form.justification")}</Field.Label>
                <Textarea
                  name="justification"
                  rows={3}
                  value={justification}
                  onChange={(e) => setJustification((e.target as HTMLTextAreaElement).value)}
                  placeholder={t("noAccess.form.justificationPlaceholder")}
                />
                <Field.Description>{t("noAccess.form.justificationHint")}</Field.Description>
              </Field.Root>

              <Inline gap="sm">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" variant="primary" disabled={!appId || isSubmitting}>
                  {isSubmitting ? t("noAccess.form.submitting") : t("noAccess.form.submit")}
                </Button>
              </Inline>
            </Stack>
          </fetcher.Form>
        </html.div>
      )}

      {succeeded && (
        <html.div style={styles.formWrap}>
          <Alert variant="success">{t("noAccess.requestSubmitted")}</Alert>
        </html.div>
      )}
    </html.div>
  )
}
