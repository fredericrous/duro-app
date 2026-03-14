import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.users"
import { runEffect } from "~/lib/runtime.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { config } from "~/lib/config.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertificateRepo, type UserCertificate } from "~/lib/services/CertificateRepo.server"
import { Effect } from "effect"
import { handleAdminUsersMutation, parseAdminUsersMutation } from "~/lib/mutations/admin-users"
import { CardSection } from "~/components/CardSection/CardSection"
import { UserRow } from "~/components/admin/UserRow"
import { RevokedUserRow } from "~/components/admin/RevokedUserRow"
import s from "./admin.shared.module.css"

export type AdminUsersAction = typeof action

export async function loader() {
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
        const usernames = allUsers.map((u) => u.id)
        return yield* certRepo.listAllByUsernames(usernames).pipe(Effect.catchAll(() => Effect.succeed({})))
      }),
    ),
  ])

  const systemUserIds = new Set(users.filter((u) => config.isSystemUser(u.id)).map((u) => u.id))
  return { users, revocations, systemUserIds: [...systemUserIds], certsByUser }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminUsersMutation(formData as any)
  if ("error" in parsed) return parsed
  return runEffect(handleAdminUsersMutation(parsed))
}

export default function AdminUsersPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { users, revocations, systemUserIds, certsByUser } = loaderData

  return (
    <>
      {/* Users List */}
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
                  certs={(certsByUser as Record<string, UserCertificate[]>)[user.id] ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardSection>

      {/* Revoked Users */}
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
