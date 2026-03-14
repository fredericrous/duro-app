import { useEffect, useRef } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.invites"
import { runEffect } from "~/lib/runtime.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { config } from "~/lib/config.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { Effect } from "effect"
import { handleAdminInvitesMutation, parseAdminInvitesMutation } from "~/lib/mutations/admin-invites"
import { Alert, Button, Cluster, Field, Inline, Input, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { PendingInviteRow } from "~/components/admin/PendingInviteRow"
import { FailedInviteRow } from "~/components/admin/FailedInviteRow"
import s from "./admin.shared.module.css"
import inv from "./admin.invites.module.css"

export type AdminInvitesAction = typeof action

export async function loader() {
  const [groups, pendingInvites, failedInvites] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const users = yield* UserManager
        return yield* users.getGroups
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findPending()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findFailed()
      }),
    ),
  ])

  return { groups, pendingInvites, failedInvites }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminInvitesMutation(formData as any)
  if ("error" in parsed) return parsed
  return runEffect(handleAdminInvitesMutation(parsed))
}

export default function AdminInvitesPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { groups, pendingInvites, failedInvites } = loaderData
  const fetcher = useFetcher<typeof action>()
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = fetcher.state !== "idle"
  const revalidator = useRevalidator()
  const revalidatorRef = useRef(revalidator)

  useEffect(() => {
    revalidatorRef.current = revalidator
  })

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      formRef.current?.reset()
    }
  }, [fetcher.data])

  // Auto-refresh while invites are still processing
  useEffect(() => {
    const hasIncomplete = pendingInvites.some((i) => !i.emailSent)
    if (!hasIncomplete) return

    const interval = setInterval(() => {
      if (revalidatorRef.current.state === "idle") {
        revalidatorRef.current.revalidate()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [pendingInvites])

  const actionData = fetcher.data
  const hasRevocationWarning = actionData && "warning" in actionData && "groups" in actionData

  return (
    <>
      {/* Invite Form */}
      <CardSection title={t("admin.invites.sendTitle")}>
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}
        {hasRevocationWarning && (
          <Alert variant="warning">
            <p>{actionData.warning}</p>
            <fetcher.Form method="post" style={{ marginTop: "0.5rem" }}>
              <input type="hidden" name="email" value={actionData.email} />
              <input type="hidden" name="confirmed" value="true" />
              <input type="hidden" name="revocationId" value={actionData.revocationId} />
              {(actionData.groups as string[]).map((g) => (
                <input key={g} type="hidden" name="groups" value={g} />
              ))}
              <Button type="submit" variant="primary">
                {t("admin.invites.proceedAnyway")}
              </Button>
            </fetcher.Form>
          </Alert>
        )}

        <fetcher.Form method="post" ref={formRef}>
          <Field.Root>
            <Field.Label>{t("admin.invites.emailLabel")}</Field.Label>
            <Input name="email" type="email" required placeholder={t("admin.invites.emailPlaceholder")} />
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("admin.invites.groupsLabel")}</Field.Label>
            <Cluster gap="ms">
              {groups.map((g) => (
                <label key={g.id} className={inv.checkboxLabel}>
                  <input type="checkbox" name="groups" value={`${g.id}|${g.displayName}`} />
                  <span>{g.displayName}</span>
                </label>
              ))}
            </Cluster>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("admin.invites.languageLabel")}</Field.Label>
            <LanguageSelect />
          </Field.Root>

          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? t("admin.invites.submitting") : t("admin.invites.submit")}
          </Button>
        </fetcher.Form>
      </CardSection>

      {/* Failed Invites */}
      {failedInvites.length > 0 && (
        <CardSection title={`${t("admin.invites.failedTitle")} (${failedInvites.length})`}>
          <div className={s.tableContainer}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.invites.cols.email")}</th>
                  <th>{t("admin.invites.cols.error")}</th>
                  <th>{t("admin.invites.cols.failedAt")}</th>
                  <th>{t("admin.invites.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {failedInvites.map((i) => (
                  <FailedInviteRow key={i.id} invite={i} />
                ))}
              </tbody>
            </table>
          </div>
        </CardSection>
      )}

      {/* Active Invites */}
      <CardSection title={`${t("admin.invites.activeTitle")} (${pendingInvites.length})`}>
        {pendingInvites.length === 0 ? (
          <Text variant="bodySm" color="muted" as="p">
            {t("admin.invites.noActive")}
          </Text>
        ) : (
          <div className={s.tableContainer}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.invites.cols.email")}</th>
                  <th>{t("admin.invites.cols.groups")}</th>
                  <th>{t("admin.invites.cols.status")}</th>
                  <th>{t("admin.invites.cols.invitedBy")}</th>
                  <th>{t("admin.invites.cols.expires")}</th>
                  <th>{t("admin.invites.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((i) => (
                  <PendingInviteRow key={i.id} invite={i} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardSection>
    </>
  )
}
