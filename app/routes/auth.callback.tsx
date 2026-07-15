import { redirect } from "react-router"
import { useTranslation } from "react-i18next"
import { LinkButton } from "@duro-app/ui"
import type { Route } from "./+types/auth.callback"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { runEffect } from "~/lib/runtime.server"
import { OidcClient } from "~/lib/services/OidcClient.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { GroupSyncService } from "~/lib/governance/GroupSyncService.server"
import { authMode } from "~/lib/governance-mode.server"
import { getPkceData, createSessionCookie, clearPkceCookie } from "~/lib/session.server"
import { Effect } from "effect"

export async function loader({ request }: Route.LoaderArgs) {
  const pkce = await getPkceData(request)
  if (!pkce) {
    throw redirect("/")
  }

  // Reconstruct callback URL with the registered redirect_uri origin
  // (behind reverse proxy, request.url may have a localhost origin)
  const reqUrl = new URL(request.url)
  const callbackUrl = new URL(process.env.OIDC_REDIRECT_URI!)
  callbackUrl.search = reqUrl.search

  const user = await runEffect(
    Effect.gen(function* () {
      const oidc = yield* OidcClient
      return yield* oidc.exchangeCode(callbackUrl, pkce.codeVerifier, pkce.state)
    }),
  )

  // Upsert principal + sync OIDC groups to governance model
  if (authMode !== "legacy") {
    await runEffect(
      Effect.gen(function* () {
        const principalRepo = yield* PrincipalRepo
        const groupSync = yield* GroupSyncService
        const principal = yield* principalRepo.ensureUser(user.sub, user.name, user.email)
        yield* groupSync.syncGroups(principal.id, user.groups)
      }).pipe(Effect.catchAll((e) => Effect.logWarning("auth callback: governance sync failed", { error: String(e) }))),
    )
  }

  const sessionCookie = await createSessionCookie({
    sub: user.sub,
    name: user.name,
    email: user.email,
    groups: user.groups,
  })

  const returnUrl = pkce.returnUrl || "/"
  const headers = new Headers()
  headers.append("Set-Cookie", sessionCookie)
  headers.append("Set-Cookie", clearPkceCookie())

  throw redirect(returnUrl, { headers })
}

/**
 * Every new user passes through this route. A stale PKCE state or an IdP hiccup
 * makes the loader's code exchange throw — without a boundary here it falls to
 * the root one and shows a raw error. Give them a clean "try again" instead.
 */
export function ErrorBoundary() {
  const { t } = useTranslation()
  return (
    <ErrorCard
      title={t("authError.title")}
      message={t("authError.message")}
      action={
        <LinkButton href="/" variant="primary" fullWidth>
          {t("authError.retry")}
        </LinkButton>
      }
    />
  )
}
