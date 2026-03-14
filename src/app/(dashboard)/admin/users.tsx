import { useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { UserRow } from "~/components/admin/UserRow"
import { RevokedUserRow } from "~/components/admin/RevokedUserRow"
import s from "~/routes/admin.shared.module.css"

interface User {
  id: string
  displayName: string
  email: string
  creationDate: string
}

interface AdminUsersLoaderData {
  users: User[]
  revocations: Revocation[]
  systemUserIds: string[]
  certsByUser: Record<string, UserCertificate[]>
}

export const loader: LoaderFunction<AdminUsersLoaderData> = async () => {
  const { runEffect } = await import("~/lib/runtime.server")
  const { UserManager } = await import("~/lib/services/UserManager.server")
  const { config } = await import("~/lib/config.server")
  const { InviteRepo } = await import("~/lib/services/InviteRepo.server")
  const { CertificateRepo } = await import("~/lib/services/CertificateRepo.server")

  const [users, revocations, certsByUser] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getUsers
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findRevocations()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        const certRepo = yield* CertificateRepo
        const allUsers = yield* um.getUsers
        const usernames = allUsers.map((u: { id: string }) => u.id)
        return yield* certRepo.listAllByUsernames(usernames).pipe(Effect.catchAll(() => Effect.succeed({})))
      }),
    ),
  ])

  const systemUserIds = new Set(
    (users as User[]).filter((u) => config.isSystemUser(u.id)).map((u) => u.id),
  )
  return {
    users: users as User[],
    revocations: revocations as Revocation[],
    systemUserIds: [...systemUserIds],
    certsByUser: certsByUser as Record<string, UserCertificate[]>,
  }
}

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const { users, revocations, systemUserIds, certsByUser } = useLoaderData<typeof loader>()

  return (
    <>
      <CardSection title={`${t("admin.users.title")} (${users.length})`}>
        <div className={s.tableContainer}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{t("admin.users.cols.username")}</th>
                <th>{t("admin.users.cols.displayName")}</th>
                <th>{t("admin.users.cols.email")}</th>
                <th>{t("admin.users.cols.created")}</th>
                <th>{t("admin.users.cols.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSystem={systemUserIds.includes(user.id)}
                  certs={certsByUser[user.id] ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardSection>

      {revocations.length > 0 && (
        <CardSection title={`${t("admin.users.revokedTitle")} (${revocations.length})`}>
          <div className={s.tableContainer}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.users.cols.email")}</th>
                  <th>{t("admin.users.cols.username")}</th>
                  <th>{t("admin.users.cols.reason")}</th>
                  <th>{t("admin.users.cols.revoked")}</th>
                  <th>{t("admin.users.cols.by")}</th>
                  <th>{t("admin.users.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {revocations.map((r) => (
                  <RevokedUserRow key={r.id} revocation={r} />
                ))}
              </tbody>
            </table>
          </div>
        </CardSection>
      )}
    </>
  )
}
