import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/settings.api-keys"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { ApiKeyRepo } from "~/lib/governance/ApiKeyRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { handleSettingsApiKeysMutation, parseSettingsApiKeysMutation } from "~/lib/mutations/settings-api-keys.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { ApiKeysSection } from "~/components/ApiKeysSection/ApiKeysSection"

export function meta() {
  return [{ title: "API keys - Duro settings" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const apiKeys = await runEffect(
    Effect.gen(function* () {
      const apiKeyRepo = yield* ApiKeyRepo
      const principals = yield* PrincipalRepo
      const principal = auth.sub ? yield* principals.findByExternalId(auth.sub) : null
      return principal
        ? yield* apiKeyRepo.listForPrincipal(principal.id).pipe(Effect.catchAll(() => Effect.succeed([])))
        : []
    }),
  )
  return { apiKeys }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsApiKeysMutation(formData as unknown as FormData, auth)
  if ("error" in parsed) return { apiKeyError: parsed.error }
  return await runEffect(handleSettingsApiKeysMutation(parsed))
}

export default function ApiKeysSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  return (
    <CardSection title={t("settings.apiKeys.heading")}>
      <ApiKeysSection apiKeys={loaderData.apiKeys} />
    </CardSection>
  )
}
