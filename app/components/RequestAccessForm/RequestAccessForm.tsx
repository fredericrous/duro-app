import { useMemo, useState } from "react"
import type { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Alert, Button, Combobox, Field, Inline, Stack, Text, Textarea } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import type { AppCatalogEntry } from "~/lib/apps-catalog.server"

const styles = css.create({
  formWrap: {
    width: "100%",
    maxWidth: 360,
    textAlign: "left",
  },
})

type Fetcher = ReturnType<typeof useFetcher>

interface RequestAccessFormProps {
  /** Catalog entries for apps the user can submit a request against. */
  apps: ReadonlyArray<AppCatalogEntry>
  fetcher: Fetcher
  /** Where the form posts. Defaults to current route. */
  action?: string
  /** App preselected from the row that opened the form. */
  preselectedAppId?: string
  /** Hide the cancel button when the form is rendered inline (NoAccess page). */
  hideCancel?: boolean
  /** Called when the user clicks Cancel (only meaningful when hideCancel is false). */
  onCancel?: () => void
}

const requestableRolesFor = (entry: AppCatalogEntry | undefined) => {
  if (!entry) return []
  const set = new Set(entry.requestableRoleIds)
  return entry.roles.filter((r) => set.has(r.id))
}

export function RequestAccessForm({
  apps,
  fetcher,
  action,
  preselectedAppId,
  hideCancel = false,
  onCancel,
}: RequestAccessFormProps) {
  const { t } = useTranslation()
  const [appId, setAppId] = useState(preselectedAppId ?? "")
  const [roleId, setRoleId] = useState(() => {
    const initialRoles = requestableRolesFor(apps.find((e) => e.app.id === preselectedAppId))
    return initialRoles.length === 1 ? initialRoles[0].id : ""
  })
  const [justification, setJustification] = useState("")

  // React-recommended "adjust state when props change" pattern: instead of an
  // effect, compare against a tracked previous value during render and update
  // synchronously. Avoids a cascading render and satisfies the React Compiler
  // set-state-in-effect rule.
  const [prevPreselected, setPrevPreselected] = useState(preselectedAppId)
  if (preselectedAppId !== prevPreselected) {
    setPrevPreselected(preselectedAppId)
    if (preselectedAppId !== undefined) {
      const next = apps.find((e) => e.app.id === preselectedAppId)
      const r = requestableRolesFor(next)
      setAppId(preselectedAppId)
      setRoleId(r.length === 1 ? r[0].id : "")
    }
  }

  const onAppChange = (v: string | null) => {
    const id = v ?? ""
    setAppId(id)
    const r = requestableRolesFor(apps.find((e) => e.app.id === id))
    setRoleId(r.length === 1 ? r[0].id : "")
  }

  const appLabels = useMemo(
    () => Object.fromEntries(apps.map((e) => [e.app.id, `${e.app.displayName} (${e.app.slug})`])),
    [apps],
  )

  const selectedEntry = apps.find((e) => e.app.id === appId)
  const requestableRoles = requestableRolesFor(selectedEntry)
  const roleLabels = useMemo(
    () => Object.fromEntries(requestableRoles.map((r) => [r.id, `${r.displayName} (${r.slug})`])),
    [requestableRoles],
  )

  // Roles the user already holds on the selected app — shown for context so it's
  // clear what's already granted (the role picker only lists requestable roles).
  const grantedRoleNames = useMemo(() => {
    if (!selectedEntry) return []
    const granted = new Set(selectedEntry.grantedRoleIds ?? [])
    return selectedEntry.roles.filter((r) => granted.has(r.id)).map((r) => r.displayName)
  }, [selectedEntry])

  const isSubmitting = fetcher.state !== "idle"
  // Discriminated submit outcome from routes/home.tsx. Three success-shaped
  // states (submitted / auto_approved / duplicate) plus error; the form
  // branches on outcome so each case gets its own copy + variant.
  const data = (fetcher.data ?? null) as
    | { outcome: "submitted" | "auto_approved" | "duplicate" }
    | { outcome: "error"; error: string }
    | null
  const errorCode = data && data.outcome === "error" ? data.error : undefined

  if (data && data.outcome !== "error") {
    const variant: "success" | "info" = data.outcome === "duplicate" ? "info" : "success"
    const messageKey =
      data.outcome === "auto_approved"
        ? "noAccess.autoApproved"
        : data.outcome === "duplicate"
          ? "noAccess.alreadyPending"
          : "noAccess.requestSubmitted"
    return (
      <html.div style={styles.formWrap}>
        <Alert variant={variant}>{t(messageKey)}</Alert>
      </html.div>
    )
  }

  const noRequestableRolesForApp =
    selectedEntry !== undefined && requestableRoles.length === 0 && selectedEntry.roles.length > 0

  return (
    <html.div style={styles.formWrap}>
      <fetcher.Form method="post" action={action}>
        <input type="hidden" name="intent" value="requestAccess" />
        <input type="hidden" name="applicationId" value={appId} />
        <input type="hidden" name="roleId" value={roleId} />
        <Stack gap="md">
          {errorCode && (
            <Alert variant="error">
              {t(`noAccess.error.${errorCode}`, { defaultValue: t("noAccess.error.unknown") }) as string}
            </Alert>
          )}
          <Field.Root>
            <Field.Label>{t("noAccess.form.application")}</Field.Label>
            <Combobox.Root value={appId} onValueChange={onAppChange} initialLabels={appLabels}>
              <Combobox.Input placeholder={t("noAccess.form.applicationPlaceholder")} />
              <Combobox.Popup>
                {apps.map((e) => (
                  <Combobox.Item key={e.app.id} value={e.app.id}>
                    {appLabels[e.app.id]}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("noAccess.form.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
          </Field.Root>

          {selectedEntry && grantedRoleNames.length > 0 && (
            <Text color="muted" variant="caption">
              {t("noAccess.form.alreadyHave", { roles: grantedRoleNames.join(", ") })}
            </Text>
          )}

          {selectedEntry && requestableRoles.length > 0 && (
            <Field.Root>
              <Field.Label>{t("noAccess.form.role")}</Field.Label>
              <Combobox.Root value={roleId} onValueChange={(v) => setRoleId(v ?? "")} initialLabels={roleLabels}>
                <Combobox.Input placeholder={t("noAccess.form.rolePlaceholder")} />
                <Combobox.Popup>
                  {requestableRoles.map((r) => (
                    <Combobox.Item key={r.id} value={r.id}>
                      {roleLabels[r.id]}
                    </Combobox.Item>
                  ))}
                  <Combobox.Empty>{t("noAccess.form.noResults")}</Combobox.Empty>
                </Combobox.Popup>
              </Combobox.Root>
            </Field.Root>
          )}

          {noRequestableRolesForApp && <Alert variant="info">{t("noAccess.form.noRequestableRoles")}</Alert>}

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
            {!hideCancel && (
              <Button type="button" variant="secondary" onClick={() => onCancel?.()}>
                {t("common.cancel")}
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!appId || !roleId || isSubmitting}>
              {isSubmitting ? t("noAccess.form.submitting") : t("noAccess.form.submit")}
            </Button>
          </Inline>
        </Stack>
      </fetcher.Form>
    </html.div>
  )
}
