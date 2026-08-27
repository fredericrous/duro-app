import { Suspense, useMemo } from "react"
import { html } from "react-strict-dom"
import { redirect, useSubmit, useNavigation } from "react-router"
import { Trans, useTranslation } from "react-i18next"
import { Schema } from "effect"
import { Effect } from "effect"
import type { Route } from "./+types/setup"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { acceptInviteById, resolvePendingCertInvite } from "~/lib/workflows/invite.server"
import { parseXfccCert, canonicalSerial } from "~/lib/client-cert.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Button, Field, Fieldset, Form, Heading, LinkButton, Input, Stack, StatusIcon, Text } from "@duro-app/ui"

type SetupError = "no_cert" | "invalid" | "revoked" | "expired" | "too_many_attempts" | "unknown"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Set up your account — ${data.appName}` : "Set up your account" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const xfcc = request.headers.get("x-forwarded-client-cert")
  const resolved = await runEffect(resolvePendingCertInvite(xfcc).pipe(Effect.orDie))

  if (resolved.kind === "has_account") {
    // The account exists — send them into the app (which puts them through
    // login) rather than a dead-end. Relative: this request is already on home.
    throw redirect("/")
  }
  if (resolved.kind === "pending") {
    return { valid: true as const, email: resolved.email, appName: config.appName }
  }
  return { valid: false as const, error: resolved.kind as SetupError, appName: config.appName }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (!isOriginAllowed(origin)) {
    return { error: "invalid_origin" as const }
  }

  const formData = await request.formData()
  const username = (formData.get("username") as string)?.trim()
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) return { error: "invalid_username" as const }
  if (!password || password.length < 12) return { error: "password_too_short" as const }
  if (password !== confirmPassword) return { error: "password_mismatch" as const }

  // Re-derive the invite from the PRESENTED certificate — never a hidden field —
  // so account creation is bound to the cert the TLS layer actually validated.
  const xfcc = request.headers.get("x-forwarded-client-cert")

  try {
    const outcome = await runEffect(
      Effect.gen(function* () {
        const resolved = yield* resolvePendingCertInvite(xfcc)
        if (resolved.kind === "has_account") return { redirectHome: true as const }
        if (resolved.kind !== "pending") return { error: resolved.kind } as const

        const inviteRepo = yield* InviteRepo
        const audit = yield* AuditService
        yield* inviteRepo.incrementAttemptById(resolved.inviteId).pipe(Effect.ignore)
        yield* acceptInviteById(resolved.inviteId, { username, password })
        // Audit with the identifier only — never the raw cert material.
        yield* audit
          .emit({
            eventType: "invite.resumed",
            targetType: "user_certificate",
            targetId: canonicalSerial(parseXfccCert(xfcc)?.serial ?? ""),
            metadata: { username, inviteId: resolved.inviteId },
          })
          .pipe(Effect.catchAll(() => Effect.void))
        return { success: true as const }
      }).pipe(
        Effect.catchAll((e) =>
          Effect.succeed({ error: (e as { message?: string })?.message ?? "create_failed" } as const),
        ),
      ),
    )

    if ("redirectHome" in outcome) throw redirect("/")
    if ("success" in outcome) return { success: true as const, homeUrl: config.homeUrl }
    // Claim lost / expired between loader and submit → friendly, not scary.
    return { error: "already_setup" as const }
  } catch (e) {
    if (e instanceof Response) throw e
    console.error("[setup] action error")
    return { error: "create_failed" as const }
  }
}

export default function SetupPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const submit = useSubmit()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  const schema = useMemo(
    () =>
      Schema.Struct({
        username: Schema.String.pipe(
          Schema.pattern(/^[a-zA-Z0-9_-]{3,32}$/, { message: () => t("createAccount.validation.usernameFormat") }),
        ),
        password: Schema.String.pipe(
          Schema.minLength(12, { message: () => t("createAccount.validation.passwordLength") }),
        ),
        confirmPassword: Schema.String,
      }).pipe(
        Schema.filter((data) =>
          data.password === data.confirmPassword
            ? undefined
            : { message: t("createAccount.validation.passwordMismatch"), path: ["confirmPassword"] },
        ),
      ),
    [t],
  )

  if (actionData && "success" in actionData && actionData.success) {
    return (
      <CenteredCardPage>
        <Stack gap="lg" align="center">
          <StatusIcon name="check-circle" size="xxl" variant="success" />
          <Heading level={1}>{t("createAccount.success.title")}</Heading>
          <Text as="p" color="muted">
            {t("createAccount.success.message", { appName: loaderData.appName })}
          </Text>
        </Stack>
        <LinkButton href={actionData.homeUrl} variant="primary" fullWidth>
          {t("createAccount.success.goHome")}
        </LinkButton>
      </CenteredCardPage>
    )
  }

  if (!loaderData.valid) {
    return <SetupErrorView code={loaderData.error} />
  }

  const error = actionData && "error" in actionData ? actionData.error : undefined

  return (
    <CenteredCardPage>
      <Heading level={1}>{t("createAccount.heading")}</Heading>
      <Text as="p" color="muted">
        <Trans
          i18nKey="createAccount.subtitle"
          values={{ email: loaderData.email }}
          components={{ strong: <html.strong /> }}
        />
      </Text>
      {error && (
        <Text as="p" color="error" variant="bodySm">
          {t(`createAccount.error.${error}`, { defaultValue: t("createAccount.error.create_failed") })}
        </Text>
      )}
      <Suspense fallback={null}>
        <Form
          schema={schema}
          defaultValues={{ username: "", password: "", confirmPassword: "" }}
          onSubmit={(data) => submit(data, { method: "post", action: "/setup" })}
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
      </Suspense>
    </CenteredCardPage>
  )
}

function SetupErrorView({ code }: { code: SetupError }) {
  const { t } = useTranslation()
  if (code === "expired") {
    return (
      <ErrorCard icon="clock" tone="warning" title={t("invite.expired.title")} message={t("invite.expired.message")} />
    )
  }
  const messageKey =
    code === "revoked"
      ? "invite.revoked.message"
      : code === "too_many_attempts"
        ? "invite.error.tooManyAttempts"
        : code === "no_cert"
          ? "setup.error.noCert"
          : "invite.error.invalid"
  const titleKey = code === "revoked" ? "invite.revoked.title" : "invite.error.title"
  return <ErrorCard title={t(titleKey)} message={t(messageKey)} />
}
