import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import { redirect } from "react-router"
import type { Route } from "./+types/settings.git"
import { requireAuth } from "~/lib/auth.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { runEffect } from "~/lib/runtime.server"
import { ForgejoClient, type GitSshKey } from "~/lib/services/ForgejoClient.server"
import { handleSettingsGitKeysMutation, parseSettingsGitKeysMutation } from "~/lib/mutations/settings-git-keys.server"
import { GitKeysSection } from "~/components/GitKeysSection/GitKeysSection"

export function meta() {
  return [{ title: "Git access - Duro settings" }]
}

export type GitPageState =
  | { status: "account_missing"; keys: GitSshKey[] }
  | { status: "unavailable"; keys: GitSshKey[] }
  | { status: "ready"; keys: GitSshKey[] }

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  // Unconfigured → the nav item isn't rendered either; a direct hit lands on
  // the settings index rather than a broken page (settings.security precedent).
  if (!config.forgejoUrl) throw redirect("/settings")

  const username = auth.user?.trim() ?? ""
  const state = await runEffect(
    Effect.gen(function* () {
      const forgejo = yield* ForgejoClient
      if (username === "") return { status: "account_missing" as const, keys: [] }
      const exists = yield* forgejo.userExists(username)
      if (!exists) return { status: "account_missing" as const, keys: [] }
      const keys = yield* forgejo.listKeys(username)
      return { status: "ready" as const, keys }
    }).pipe(
      // Forge down (or misconfigured) must render a calm panel, not the error
      // boundary — and runEffect's E = never discipline requires the catch.
      Effect.catchAll((e) =>
        Effect.logWarning("git keys load failed", { error: String(e) }).pipe(
          Effect.as({ status: "unavailable" as const, keys: [] }),
        ),
      ),
    ),
  )
  return { ...(state as GitPageState), username, gitWebUrl: config.forgejoPublicUrl }
}

export async function action({ request }: Route.ActionArgs) {
  // CSRF: state-changing action → Origin must match (devices.tsx precedent).
  if (!isOriginAllowed(request.headers.get("origin"))) {
    return Response.json({ error: "Invalid origin" }, { status: 403 })
  }
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsGitKeysMutation(formData as unknown as FormData, auth)
  if ("error" in parsed) return { gitKeyError: "unknown" as const }
  return await runEffect(handleSettingsGitKeysMutation(parsed))
}

export default function GitSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  return (
    <GitKeysSection
      status={loaderData.status}
      keys={loaderData.keys}
      username={loaderData.username}
      gitWebUrl={loaderData.gitWebUrl}
      heading={t("settings.git.heading")}
    />
  )
}
