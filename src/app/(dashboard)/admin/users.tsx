import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { UserRow } from "~/components/admin/UserRow"
import { RevokedUserRow } from "~/components/admin/RevokedUserRow"
import { PageShell, ScrollArea, Table, Text } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"

interface User {
  id: string
  displayName: string
  email: string
  creationDate: string
}

interface AdminUsersData {
  user: string
  isAdmin: boolean
  users: User[]
  revocations: Revocation[]
  systemUserIds: string[]
  certsByUser: Record<string, UserCertificate[]>
}

export default function AdminUsersPage() {
  const { t } = useTranslation()

  const { data: pageData, isLoading } = useQuery<AdminUsersData>({
    queryKey: ["admin-users"],
    queryFn: () => fetch("/admin/users").then((r) => r.json()),
  })

  if (isLoading || !pageData) {
    return (
      <PageShell maxWidth="lg" header={<Header user="" isAdmin={false} />}>
        <Text as="p" color="muted">Loading...</Text>
      </PageShell>
    )
  }

  const { user, isAdmin, users, revocations, systemUserIds, certsByUser } = pageData

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
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
                  {users.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      isSystem={systemUserIds.includes(u.id)}
                      certs={certsByUser[u.id] ?? []}
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
    </PageShell>
  )
}
