import type { Route } from "./+types/recover"
import { Form } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { requestRecovery } from "~/lib/workflows/recovery.server"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { Alert, Button, Field, Fieldset, Heading, Input, Stack, Text, Textarea } from "@duro-app/ui"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Recover access — ${data.appName}` : "Recover access" }]
}

export async function loader() {
  // 404 (not just disabled) when the feature is off — don't advertise it.
  if (!config.recoveryEnabled) throw new Response("Not found", { status: 404 })
  return { appName: config.appName }
}

function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim() || null
  return request.headers.get("x-real-ip")
}

export async function action({ request }: Route.ActionArgs) {
  if (!config.recoveryEnabled) throw new Response("Not found", { status: 404 })
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return { error: "Invalid request origin" }
  }
  const fd = await request.formData()
  const email = ((fd.get("email") as string) ?? "").trim()
  const note = ((fd.get("note") as string) ?? "").trim() || null
  if (!email) return { error: "Email is required" }

  // requestRecovery is intentionally silent on every branch (unknown account,
  // rate-limited, duplicate) — so we always return the same generic outcome.
  await runEffect(requestRecovery({ email, note, requestIp: clientIp(request) }).pipe(Effect.ignore))
  return { submitted: true as const }
}

export default function RecoverPage({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation()

  if (actionData && "submitted" in actionData) {
    return (
      <CenteredCardPage>
        <Stack gap="md">
          <Heading level={1}>{t("recover.sent.title")}</Heading>
          <Alert variant="success">{t("recover.sent.message")}</Alert>
        </Stack>
      </CenteredCardPage>
    )
  }

  return (
    <CenteredCardPage>
      <Stack gap="lg">
        <Stack gap="sm">
          <Heading level={1}>{t("recover.title")}</Heading>
          <Text as="p" color="muted">
            {t("recover.subtitle")}
          </Text>
        </Stack>

        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

        <Form method="post">
          <Fieldset.Root gap="md">
            <Field.Root name="email">
              <Field.Label>{t("recover.emailLabel")}</Field.Label>
              <Input type="email" name="email" placeholder={t("recover.emailPlaceholder")} required />
            </Field.Root>
            <Field.Root name="note">
              <Field.Label>{t("recover.noteLabel")}</Field.Label>
              <Textarea name="note" placeholder={t("recover.notePlaceholder")} rows={3} />
              <Field.Description>{t("recover.noteHint")}</Field.Description>
            </Field.Root>
            <Button type="submit" variant="primary" fullWidth>
              {t("recover.submit")}
            </Button>
          </Fieldset.Root>
        </Form>
      </Stack>
    </CenteredCardPage>
  )
}
