import { use } from "react"
import { useTranslation } from "react-i18next"
import { useLocalSearchParams } from "expo-router"
import { Alert, Button, Field, Fieldset, Heading, Input, LinkButton, Text } from "@duro-app/ui"
import { useAction } from "~/hooks/useAction"

export function CertGate({
  certPromise,
  actionData,
}: {
  certPromise: Promise<boolean>
  actionData: { error?: string } | undefined
}) {
  const { t } = useTranslation()
  const { token } = useLocalSearchParams<{ token: string }>()
  const certInstalled = use(certPromise)
  const action = useAction<{ error?: string }>(`/invite/${token}/create-account`)
  const isSubmitting = action.state === "submitting"
  const error = action.data?.error ?? actionData?.error

  if (!certInstalled) {
    return (
      <Alert variant="warning">
        <Heading level={2} variant="headingSm">
          {t("createAccount.certRequired.title")}
        </Heading>
        <Text as="p">{t("createAccount.certRequired.message")}</Text>
        <LinkButton href={`/invite/${token}`} variant="primary">
          {t("createAccount.certRequired.back")}
        </LinkButton>
      </Alert>
    )
  }

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}

      <action.Form>
        <Fieldset.Root disabled={isSubmitting} gap="md">
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
              autoComplete="off"
            />
          </Field.Root>

          <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
            {isSubmitting ? t("createAccount.submitting") : t("createAccount.submit")}
          </Button>
        </Fieldset.Root>
      </action.Form>
    </>
  )
}
