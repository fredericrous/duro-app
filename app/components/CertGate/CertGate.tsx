import { use, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useLocalSearchParams } from "expo-router"
import { Schema } from "effect"
import { Alert, Button, Field, Fieldset, Form, Heading, Input, LinkButton, Text } from "@duro-app/ui"
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

  const CreateAccountSchema = useMemo(
    () =>
      Schema.Struct({
        username: Schema.String.pipe(
          Schema.pattern(/^[a-zA-Z0-9_-]{3,32}$/, {
            message: () => t("createAccount.validation.usernameFormat"),
          }),
        ),
        password: Schema.String.pipe(
          Schema.minLength(12, {
            message: () => t("createAccount.validation.passwordLength"),
          }),
        ),
        confirmPassword: Schema.String,
      }).pipe(
        Schema.filter((data) =>
          data.password === data.confirmPassword
            ? undefined
            : {
                message: t("createAccount.validation.passwordMismatch"),
                path: ["confirmPassword"],
              },
        ),
      ),
    [t],
  )

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

      <Form
        schema={CreateAccountSchema}
        defaultValues={{ username: "", password: "", confirmPassword: "" }}
        onSubmit={(data) => action.submit(data)}
      >
        {({ formState }) => (
          <Fieldset.Root disabled={isSubmitting} gap="md">
            <Field.Root name="username">
              <Field.Label>{t("createAccount.username.label")}</Field.Label>
              <Input
                placeholder={t("createAccount.username.placeholder")}
                autoComplete="username"
              />
              <Field.Description>{t("createAccount.username.hint")}</Field.Description>
              <Field.Error />
            </Field.Root>

            <Field.Root name="password">
              <Field.Label>{t("createAccount.password.label")}</Field.Label>
              <Input
                type="password"
                placeholder={t("createAccount.password.placeholder")}
                autoComplete="new-password"
              />
              <Field.Description>{t("createAccount.password.hint")}</Field.Description>
              <Field.Error />
            </Field.Root>

            <Field.Root name="confirmPassword">
              <Field.Label>{t("createAccount.confirm.label")}</Field.Label>
              <Input
                type="password"
                placeholder={t("createAccount.confirm.placeholder")}
                autoComplete="off"
              />
              <Field.Error />
            </Field.Root>

            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={isSubmitting || !formState.isValid}
            >
              {isSubmitting ? t("createAccount.submitting") : t("createAccount.submit")}
            </Button>
          </Fieldset.Root>
        )}
      </Form>
    </>
  )
}
