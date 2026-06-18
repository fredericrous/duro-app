import { useState } from "react"
import { redirect, useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/admin.setup"
import { config, isOriginAllowed } from "~/lib/config.server"
import { runEffect } from "~/lib/runtime.server"
import { isFirstRun } from "~/lib/governance/bootstrap.server"
import { submitBootstrapInviteAuto, type BootstrapErrorCode } from "~/lib/workflows/bootstrap.server"
import { Alert, Button, Field, Heading, Input, LinkButton, Stack, Text } from "@duro-app/ui"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

type SetupErrorCode = BootstrapErrorCode | "missing_email" | "wrong_origin"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Set up ${data.appName}` : "Set up your deployment" }]
}

export async function loader() {
  if (!(await runEffect(isFirstRun))) {
    throw redirect("/admin")
  }
  return {
    appName: config.appName,
    inviteBaseUrl: config.inviteBaseUrl,
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return { ok: false as const, error: "wrong_origin" as SetupErrorCode }
  }

  // Re-check first-run inside the action so a race between page load and
  // submit cannot create a second admin invite.
  if (!(await runEffect(isFirstRun))) {
    throw redirect("/admin")
  }

  const formData = await request.formData()
  const intent = formData.get("intent")
  if (intent !== "createBootstrapInvite") {
    return { ok: false as const, error: "missing_email" as SetupErrorCode }
  }
  const email = (formData.get("email") as string | null)?.trim() ?? ""
  if (!email) {
    return { ok: false as const, error: "missing_email" as SetupErrorCode }
  }

  const result = await runEffect(submitBootstrapInviteAuto({ email }).pipe(Effect.either))

  if (result._tag === "Left") {
    return { ok: false as const, error: result.left.code as SetupErrorCode }
  }

  if (result.right.resent) {
    return { ok: true as const, resent: true as const, email: result.right.email }
  }

  return {
    ok: true as const,
    resent: false as const,
    inviteToken: result.right.token,
    email: result.right.email,
  }
}

export default function AdminSetupPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const fetcher = useFetcher<typeof action>()
  const [email, setEmail] = useState("")

  const isSubmitting = fetcher.state !== "idle"
  const data = fetcher.data
  const succeeded = data?.ok === true
  const errorCode = data?.ok === false ? data.error : undefined

  if (succeeded && data.resent) {
    return (
      <CenteredCardPage>
        <Stack gap="lg">
          <Heading level={1}>{t("admin.setup.resent.title")}</Heading>
          <Text as="p">{t("admin.setup.resent.body", { email: data.email })}</Text>
        </Stack>
      </CenteredCardPage>
    )
  }

  if (succeeded) {
    const inviteUrl = `${loaderData.inviteBaseUrl}/invite/${data.inviteToken}`
    return (
      <CenteredCardPage>
        <Stack gap="lg">
          <Heading level={1}>{t("admin.setup.success.title")}</Heading>
          <Text as="p">{t("admin.setup.success.body", { email: data.email })}</Text>

          <Field.Root>
            <Field.Label>{t("admin.setup.success.urlLabel")}</Field.Label>
            <Text as="p" variant="code">
              {inviteUrl}
            </Text>
          </Field.Root>

          <LinkButton href={inviteUrl} variant="primary" fullWidth>
            {t("admin.setup.success.continue")}
          </LinkButton>
        </Stack>
      </CenteredCardPage>
    )
  }

  return (
    <CenteredCardPage>
      <Stack gap="lg">
        <Stack gap="sm">
          <Heading level={1}>
            {t("admin.setup.heading")}
            <HelpPopover termKey="glossary.bootstrap" />
          </Heading>
          <Text as="p" color="muted">
            {t("admin.setup.subtitle", { appName: loaderData.appName })}
          </Text>
        </Stack>

        {errorCode && <Alert variant="error">{t(`admin.setup.error.${errorCode}` as const) as string}</Alert>}

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="createBootstrapInvite" />
          <Stack gap="md">
            <Field.Root>
              <Field.Label>{t("admin.setup.emailLabel")}</Field.Label>
              <Input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </Field.Root>

            <Button type="submit" variant="primary" fullWidth disabled={isSubmitting || email.trim() === ""}>
              {isSubmitting ? t("admin.setup.submitting") : t("admin.setup.submit")}
            </Button>
          </Stack>
        </fetcher.Form>
      </Stack>
    </CenteredCardPage>
  )
}
