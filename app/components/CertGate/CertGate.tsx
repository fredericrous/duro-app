import { use } from "react"
import { useNavigation } from "react-router"
import { useTranslation } from "react-i18next"
import { Alert, Button, Field, Heading, Input } from "@duro-app/ui"
import styles from "~/routes/invite-create-account.module.css"

export function CertGate({
  certPromise,
  actionData,
}: {
  certPromise: Promise<boolean>
  actionData: { error?: string } | undefined
}) {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"
  const certInstalled = use(certPromise)

  if (!certInstalled) {
    return (
      <Alert variant="warning">
        <Heading level={2} variant="headingSm">
          {t("createAccount.certRequired.title")}
        </Heading>
        <p>{t("createAccount.certRequired.message")}</p>
        <a href=".." className={styles.certBackLink}>
          {t("createAccount.certRequired.back")}
        </a>
      </Alert>
    )
  }

  return (
    <>
      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

      <form method="post" className={styles.accountForm}>
        <fieldset disabled={isSubmitting}>
          <Field.Root>
            <Field.Label>{t("createAccount.username.label")}</Field.Label>
            <Input
              name="username"
              required
              pattern="^[a-zA-Z0-9_-]{3,32}$"
              placeholder={t("createAccount.username.placeholder")}
              autoComplete="username"
            />
            <Field.Description>{t("createAccount.username.hint")}</Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("createAccount.password.label")}</Field.Label>
            <Input
              name="password"
              type="password"
              required
              minLength={12}
              placeholder={t("createAccount.password.placeholder")}
              autoComplete="new-password"
            />
            <Field.Description>{t("createAccount.password.hint")}</Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("createAccount.confirm.label")}</Field.Label>
            <Input
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              placeholder={t("createAccount.confirm.placeholder")}
              autoComplete="new-password"
            />
          </Field.Root>

          <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
            {isSubmitting ? t("createAccount.submitting") : t("createAccount.submit")}
          </Button>
        </fieldset>
      </form>
    </>
  )
}
