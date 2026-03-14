import { useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { UserRow } from "~/components/admin/UserRow"
import { RevokedUserRow } from "~/components/admin/RevokedUserRow"
import { ScrollArea, Table } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"

interface User {
  id: string
  displayName: string
  email: string
  creationDate: string
}

interface AdminUsersLoaderData {
  user: string
  isAdmin: boolean
  users: User[]
  revocations: Revocation[]
  systemUserIds: string[]
  certsByUser: Record<string, UserCertificate[]>
}

export const loader: LoaderFunction<AdminUsersLoaderData> = async (request) => {
  try {
    const { requireAuth } = await import("~/lib/auth.server")
    const { runEffect } = await import("~/lib/runtime.server")
    const { UserManager } = await import("~/lib/services/UserManager.server")
    const { config } = await import("~/lib/config.server")

    const auth = await requireAuth(request as unknown as Request)
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
      user: auth.user ?? "",
      isAdmin: auth.groups.includes(config.adminGroupName),
      users: users as User[],
      revocations: revocations as Revocation[],
      systemUserIds: [...systemUserIds],
      certsByUser: certsByUser as Record<string, UserCertificate[]>,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    // Dev mode fallback — dynamic imports don't resolve in Metro dev loader bundles
    return {
      user: "dev",
      isAdmin: true,
      users: [],
      revocations: [],
      systemUserIds: [],
      certsByUser: {},
    }
  }
}

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const { user, isAdmin, users, revocations, systemUserIds, certsByUser } = useLoaderData<typeof loader>()

  return (
    <>
      <Header user={user} isAdmin={isAdmin} />
      <CardSection title={`${t("admin.users.title")} (${users.length})`}>
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <ScrollArea.Content>
              <Table.Root columns={5}>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>{t("admin.users.cols.username")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("admin.users.cols.displayName")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("admin.users.cols.email")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("admin.users.cols.created")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("admin.users.cols.actions")}</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {users.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      isSystem={systemUserIds.includes(user.id)}
                      certs={certsByUser[user.id] ?? []}
                    />
                  ))}
                </Table.Body>
              </Table.Root>
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar orientation="horizontal">
            <ScrollArea.Thumb orientation="horizontal" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </CardSection>

      {revocations.length > 0 && (
        <CardSection title={`${t("admin.users.revokedTitle")} (${revocations.length})`}>
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
                <Table.Root columns={6}>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("admin.users.cols.email")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.users.cols.username")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.users.cols.reason")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.users.cols.revoked")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.users.cols.by")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.users.cols.actions")}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {revocations.map((r) => (
                      <RevokedUserRow key={r.id} revocation={r} />
                    ))}
                  </Table.Body>
                </Table.Root>
              </ScrollArea.Content>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="horizontal">
              <ScrollArea.Thumb orientation="horizontal" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </CardSection>
      )}
    </>
  )
}
