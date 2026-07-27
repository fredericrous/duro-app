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
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Alert, Button, Heading, StatusIcon, Text } from "@duro-app/ui"

type ReinviteErrorCode = "missing_token" | "invalid" | "already_used" | "still_valid" | "send_failed" | "unknown"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Request New Invite - ${data.appName}` : "Request New Invite" }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) {
    return { canReinvite: false as const, error: "missing_token" as ReinviteErrorCode, appName: config.appName }
  }

  try {
    const tokenHash = hashToken(token)

    const { invite, p12Password } = await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const cert = yield* CertManager
        const invite = yield* repo.findByTokenHash(tokenHash)
        const p12Password = invite ? yield* cert.getP12Password(invite.id) : null
        return { invite, p12Password }
      }).pipe(Effect.orDie),
    )

    if (!invite) {
      return { canReinvite: false as const, error: "invalid" as ReinviteErrorCode, appName: config.appName }
    }

    const currentLocale = resolveLocale(request)
    if (invite.locale && invite.locale !== currentLocale) {
      throw redirect(request.url, {
        headers: { "Set-Cookie": localeCookieHeader(invite.locale) },
      })
    }

    // Claimed by a real user, or its revocation is still in flight — a fresh
    // invite can't be issued either way. (Revoked invites CAN be re-issued.)
    const status = invite.status
    if ((status._tag === "Accepted" && status.usedBy !== null) || status._tag === "Revoking") {
      return {
        canReinvite: false as const,
        error: "already_used" as ReinviteErrorCode,
        appName: config.appName,
      }
    }

    const isExpired = new Date(invite.expiresAt) < new Date()
    const passwordConsumed = p12Password === null

    if (!isExpired && !passwordConsumed) {
      return {
        canReinvite: false as const,
        error: "still_valid" as ReinviteErrorCode,
        appName: config.appName,
      }
    }

    return {
      canReinvite: true as const,
      email: invite.email,
      appName: config.appName,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    console.error("[reinvite] loader error:", e)
    return { canReinvite: false as const, error: "unknown" as ReinviteErrorCode, appName: config.appName }
  }
}

export async function action({ params }: Route.ActionArgs) {
  const token = params.token
  if (!token) {
    return { success: false as const, error: "missing_token" as ReinviteErrorCode }
  }

  const tokenHash = hashToken(token)

  const result = await runEffect(
    Effect.gen(function* () {
      const repo = yield* InviteRepo
      const cert = yield* CertManager

      const invite = yield* repo.findByTokenHash(tokenHash)
      if (!invite) {
        return { success: false as const, error: "invalid" as ReinviteErrorCode }
      }

      const status = invite.status
      if ((status._tag === "Accepted" && status.usedBy !== null) || status._tag === "Revoking") {
        return { success: false as const, error: "already_used" as ReinviteErrorCode }
      }

      yield* repo.revoke(invite.id).pipe(Effect.catchAll(() => Effect.void))
      yield* cert.deleteP12Secret(invite.id)

      // Effect.try, not bare JSON.parse: a corrupted row must fail the typed
      // channel (→ send_failed below), not escape as a defect.
      const { groups, groupNames } = yield* Effect.try({
        try: () => ({
          groups: JSON.parse(invite.groups) as number[],
          groupNames: JSON.parse(invite.groupNames) as string[],
        }),
        catch: () => new Error("Invalid groups JSON in invite"),
      })

      yield* queueInvite({
        email: invite.email,
        groups,
        groupNames,
        invitedBy: invite.invitedBy,
        locale: invite.locale,
      })

      return { success: true as const, email: invite.email }
    }).pipe(
      Effect.catchAll((e) =>
        Effect.logError("[reinvite] action error", { error: String(e) }).pipe(
          Effect.as({ success: false as const, error: "send_failed" as ReinviteErrorCode }),
        ),
      ),
    ),
  )

  return result
}

function reinviteErrorKey(code: ReinviteErrorCode): string {
  switch (code) {
    case "missing_token":
      return "reinvite.error.missingToken"
    case "invalid":
      return "reinvite.error.invalid"
    case "already_used":
      return "reinvite.error.alreadyUsed"
    case "still_valid":
      return "reinvite.error.stillValid"
    case "send_failed":
      return "reinvite.error.sendFailed"
    default:
      return "reinvite.error.unknown"
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
        <Heading level={1}>{t("reinvite.success.title")}</Heading>
        <Text as="p" color="muted">
          {t("reinvite.success.message", { email: actionData.email })}
        </Text>
      </CenteredCardPage>
    )
  }

  if (!loaderData.canReinvite) {
    const tone = loaderData.error === "still_valid" ? "info" : "error"
    const icon = loaderData.error === "still_valid" ? "check-done" : "x-circle"
    return (
      <ErrorCard
        icon={icon}
        tone={tone}
        title={t("reinvite.error.title")}
        message={t(reinviteErrorKey(loaderData.error))}
      />
    )
  }

  return (
    <CenteredCardPage>
      <Heading level={1}>{t("reinvite.heading")}</Heading>
      <Text as="p" color="muted">
        {t("reinvite.message", { email: loaderData.email })}
      </Text>

      {actionData && "error" in actionData && <Alert variant="error">{t(reinviteErrorKey(actionData.error))}</Alert>}

      <form method="post">
        <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
          {isSubmitting ? t("reinvite.submitting") : t("reinvite.submit")}
        </Button>
      </form>
    </CenteredCardPage>
  )
}
