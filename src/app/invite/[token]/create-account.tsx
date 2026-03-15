import { Suspense, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { CertGate } from "~/components/CertGate/CertGate"
import { Alert, Heading, LinkButton, Text } from "@duro-app/ui"

type CreateAccountLoaderData =
  | { valid: false; error: string; appName: string; healthUrl: string; homeUrl?: string }
  | { valid: true; email: string; appName: string; healthUrl: string }

export const loader: LoaderFunction<CreateAccountLoaderData> = async (request, params) => {
  try {
    const { config } = await import("~/lib/config.server")
    const { hashToken } = await import("~/lib/crypto.server")
    const { runEffect } = await import("~/lib/runtime.server")
    const { InviteRepo } = await import("~/lib/services/InviteRepo.server")
    const { CertManager } = await import("~/lib/services/CertManager.server")

    const token = params.token as string | undefined
    if (!token) {
      return {
        valid: false,
        error: "Missing invite token",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    }

    try {
      const tokenHash = hashToken(token)
      const invite = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const inv = yield* repo.findByTokenHash(tokenHash)
          if (inv) {
            const cert = yield* CertManager
            yield* cert.consumeP12Password(inv.id).pipe(Effect.ignore)
          }
          return inv
        }),
      )

      if (!invite)
        return {
          valid: false as const,
          error: "Invalid invite link",
          appName: config.appName,
          healthUrl: `${config.homeUrl}/health`,
        }
      if (invite.usedAt)
        return {
          valid: false as const,
          error: "already_used",
          appName: config.appName,
          healthUrl: `${config.homeUrl}/health`,
          homeUrl: config.homeUrl,
        }
      if (new Date(invite.expiresAt) < new Date())
        return {
          valid: false as const,
          error: "This invite has expired.",
          appName: config.appName,
          healthUrl: `${config.homeUrl}/health`,
        }
      if (invite.attempts >= 5)
        return {
          valid: false as const,
          error: "Too many attempts.",
          appName: config.appName,
          healthUrl: `${config.homeUrl}/health`,
        }

      return {
        valid: true as const,
        email: invite.email,
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    } catch (e) {
      if (e instanceof Response) throw e
      return {
        valid: false as const,
        error: "Something went wrong",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    }
  } catch {
    // Dev mode fallback — dynamic imports don't resolve in Metro dev loader bundles
    return { valid: false, error: "Dev mode", appName: "Duro", healthUrl: "/health" }
  }
}

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function CreateAccountPage() {
  const { t } = useTranslation()
  const loaderData = useLoaderData<typeof loader>()
  const [certPromise] = useState(() => {
    if (typeof window === "undefined") return Promise.resolve(false)
    return checkCert(loaderData.healthUrl)
  })

  if (!loaderData.valid) {
    if (loaderData.error === "already_used") {
      return (
        <CenteredCardPage>
          <Heading level={1}>{t("createAccount.success.title")}</Heading>
          <Alert variant="success">
            <Text as="p">{t("createAccount.success.message")}</Text>
          </Alert>
          <LinkButton href={loaderData.homeUrl ?? "/"} variant="primary" fullWidth>
            {t("createAccount.success.goHome")}
          </LinkButton>
        </CenteredCardPage>
      )
    }
    return <ErrorCard title={t("createAccount.heading")} message={loaderData.error} />
  }

  return (
    <CenteredCardPage>
      <Heading level={1}>{t("createAccount.heading")}</Heading>
      <Text as="p" color="muted">
        <Trans
          i18nKey="createAccount.subtitle"
          values={{ email: loaderData.email }}
          components={{ strong: <strong /> }}
        />
      </Text>
      <Suspense
        fallback={
          <Text as="p" color="muted" variant="bodySm">
            {t("createAccount.certCheck")}
          </Text>
        }
      >
        <CertGate certPromise={certPromise} actionData={undefined} />
      </Suspense>
    </CenteredCardPage>
  )
}
