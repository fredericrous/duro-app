import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import type { Invite } from "~/lib/services/InviteRepo.server"
import { useAction } from "~/hooks/useAction"
import type { AdminInvitesResult } from "~/lib/mutations/admin-invites"
import { Alert, Button, Cluster, Field, Inline, Input, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { PendingInviteRow } from "~/components/admin/PendingInviteRow"
import { FailedInviteRow } from "~/components/admin/FailedInviteRow"
import s from "~/routes/admin.shared.module.css"
import inv from "~/routes/admin.invites.module.css"

interface Group {
  id: number
  displayName: string
}

interface AdminInvitesLoaderData {
  groups: Group[]
  pendingInvites: Invite[]
  failedInvites: Invite[]
}

export const loader: LoaderFunction<AdminInvitesLoaderData> = async () => {
  try {
    const { runEffect } = await import("~/lib/runtime.server")
    const { UserManager } = await import("~/lib/services/UserManager.server")
    const { InviteRepo } = await import("~/lib/services/InviteRepo.server")

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

    return {
      groups: groups as Group[],
      pendingInvites: pendingInvites as Invite[],
      failedInvites: failedInvites as Invite[],
    }
  } catch {
    // Dev mode fallback — dynamic imports don't resolve in Metro dev loader bundles
    return {
      groups: [],
      pendingInvites: [],
      failedInvites: [],
    }
  }
}

export default function AdminInvitesPage() {
  const { t } = useTranslation()
  const { groups, pendingInvites, failedInvites } = useLoaderData<typeof loader>()
  const inviteAction = useAction<AdminInvitesResult>("/admin/invites")
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = inviteAction.state !== "idle"

  useEffect(() => {
    if (inviteAction.data && "success" in inviteAction.data && inviteAction.data.success) {
      formRef.current?.reset()
    }
  }, [inviteAction.data])

  const actionData = inviteAction.data
  const hasRevocationWarning = actionData && "warning" in actionData && "groups" in actionData

  return (
    <>
      <CardSection title={t("admin.invites.sendTitle")}>
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}
        {hasRevocationWarning && (
          <Alert variant="warning">
            <p>{actionData.warning}</p>
            <inviteAction.Form>
              <input type="hidden" name="email" value={actionData.email} />
              <input type="hidden" name="confirmed" value="true" />
              <input type="hidden" name="revocationId" value={actionData.revocationId} />
              {actionData.groups.map((g) => (
                <input key={g} type="hidden" name="groups" value={g} />
              ))}
              <Button type="submit" variant="primary">
                {t("admin.invites.proceedAnyway")}
              </Button>
            </inviteAction.Form>
          </Alert>
        )}

        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); inviteAction.submit(new FormData(e.currentTarget) as unknown as Record<string, string>) }}>
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
        </form>
      </CardSection>

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
