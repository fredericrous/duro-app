import { redirect, useNavigation } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/reinvite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { config } from "~/lib/config.server"
import { queueInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
import { Effect } from "effect"
import { Button } from "@base-ui/react/button"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { StatusIcon } from "~/components/StatusIcon/StatusIcon"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Alert } from "~/components/Alert/Alert"
import shared from "./shared.module.css"
import local from "./reinvite.module.css"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Request New Invite - ${data.appName}` : "Request New Invite" }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) {
    return { canReinvite: false as const, error: "Missing token", appName: config.appName }
  }

  try {
    const tokenHash = hashToken(token)

    return await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const cert = yield* CertManager

        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite) {
          return { canReinvite: false as const, error: "Invalid link", appName: config.appName }
        }

        // Set locale cookie from invite if different from current
        const currentLocale = resolveLocale(request)
        if (invite.locale && invite.locale !== currentLocale) {
          throw redirect(request.url, {
            headers: { "Set-Cookie": localeCookieHeader(invite.locale) },
          })
        }

        // If account was already created, no re-invite
        if (invite.usedBy && invite.usedBy !== "__revoked__") {
          return {
            canReinvite: false as const,
            error:
              "This invite has already been used to create an account. If you need help, contact the person who invited you.",
            appName: config.appName,
          }
        }

        // Only allow re-invite if expired or password already consumed
        const isExpired = new Date(invite.expiresAt) < new Date()
        const pw = yield* cert.getP12Password(invite.id)
        const passwordConsumed = pw === null

        if (!isExpired && !passwordConsumed) {
          return {
            canReinvite: false as const,
            error: "Your invite is still valid. Check your email for the original invitation link.",
            appName: config.appName,
          }
        }

        return {
          canReinvite: true as const,
          email: invite.email,
          appName: config.appName,
        }
      }),
    )
  } catch (e) {
    if (e instanceof Response) throw e
    return { canReinvite: false as const, error: "Something went wrong", appName: config.appName }
  }
}

export async function action({ params }: Route.ActionArgs) {
  const token = params.token
  if (!token) {
    return { success: false as const, error: "Missing token" }
  }

  try {
    const tokenHash = hashToken(token)

    const result = await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const cert = yield* CertManager

        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite) {
          return { success: false as const, error: "Invalid link" }
        }

        if (invite.usedBy && invite.usedBy !== "__revoked__") {
          return { success: false as const, error: "Account already created" }
        }

        // Revoke old invite
        yield* repo.revoke(invite.id).pipe(Effect.catchAll(() => Effect.void))

        // Clean up old cert secret
        yield* cert.deleteP12Secret(invite.id)

        // Queue new invite with same details
        const groups = JSON.parse(invite.groups) as number[]
        const groupNames = JSON.parse(invite.groupNames) as string[]

        yield* queueInvite({
          email: invite.email,
          groups,
          groupNames,
          invitedBy: invite.invitedBy,
          locale: invite.locale,
        })

        return { success: true as const, email: invite.email }
      }),
    )

    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send new invite"
    return { success: false as const, error: message }
  }
}

export default function ReinvitePage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  if (actionData && "success" in actionData && actionData.success) {
    return (
      <CenteredCardPage>
        <StatusIcon name="check-done" variant="success" />
        <h1>{t("reinvite.success.title")}</h1>
        <p
          className={local.infoText}
          dangerouslySetInnerHTML={{ __html: t("reinvite.success.message", { email: actionData.email }) }}
        />
      </CenteredCardPage>
    )
  }

  if (!loaderData.canReinvite) {
    return <ErrorCard title={t("reinvite.error.title")} message={loaderData.error} />
  }

  return (
    <CenteredCardPage>
      <h1>{t("reinvite.heading")}</h1>
      <p
        className={local.infoText}
        dangerouslySetInnerHTML={{ __html: t("reinvite.message", { email: loaderData.email }) }}
      />

      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

      <form method="post">
        <Button
          type="submit"
          disabled={isSubmitting}
          className={`${shared.btn} ${shared.btnPrimary} ${shared.btnFull}`}
        >
          {isSubmitting ? t("reinvite.submitting") : t("reinvite.submit")}
        </Button>
      </form>
    </CenteredCardPage>
  )
}
