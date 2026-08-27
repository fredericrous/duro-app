import { use, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSubmit, useNavigation, useParams } from "react-router"
import { Schema } from "effect"
import { Alert, Button, Field, Fieldset, Form, Heading, Input, LinkButton, Text } from "@duro-app/ui"
import { UnsupportedBrowser } from "~/components/UnsupportedBrowser/UnsupportedBrowser"
import type { CertStore } from "~/lib/cert-store"

export function CertGate({
  certPromise,
  actionData,
  browser,
}: {
  certPromise: Promise<boolean>
  actionData: { error?: string } | undefined
  browser: { store: CertStore; onIos: boolean; inviteUrl: string | null; chromeUrl: string | null }
}) {
  const { t } = useTranslation()
  const { token } = useParams()
  // Navigation submit (not a fetcher) so the action's `{success}` lands in the
  // route's actionData — the page renders the success view from it, which a
  // fetcher's data could not do (and the loader revalidates to "already used").
  const submit = useSubmit()
  const navigation = useNavigation()
  const certInstalled = use(certPromise)
  const isSubmitting = navigation.state === "submitting"
  const error = actionData?.error

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

  if (!certInstalled && browser.store === "none") {
    // "Go back and install it first" is not advice here — the visitor already
    // did, in the only place this browser will never look.
    return (
      <UnsupportedBrowser
        onIos={browser.onIos}
        inviteUrl={browser.inviteUrl ?? undefined}
        chromeUrl={browser.chromeUrl}
      />
    )
  }

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
      {error && (
        <Alert variant="error">
          {t(`createAccount.error.${error}`, { defaultValue: t("createAccount.error.create_failed") })}
        </Alert>
      )}

      <Form
        schema={CreateAccountSchema}
        defaultValues={{ username: "", password: "", confirmPassword: "" }}
        onSubmit={(data) =>
          submit(data, {
            method: "post",
            action: `/invite/${token}/create-account`,
          })
        }
      >
        {() => (
          <Fieldset.Root disabled={isSubmitting} gap="md">
            <Field.Root name="username">
              <Field.Label>{t("createAccount.username.label")}</Field.Label>
              <Input placeholder={t("createAccount.username.placeholder")} autoComplete="username" />
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
              <Input type="password" placeholder={t("createAccount.confirm.placeholder")} autoComplete="off" />
              <Field.Error />
            </Field.Root>

            <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
              {isSubmitting ? t("createAccount.submitting") : t("createAccount.submit")}
            </Button>
          </Fieldset.Root>
        )}
      </Form>
    </>
  )
}
