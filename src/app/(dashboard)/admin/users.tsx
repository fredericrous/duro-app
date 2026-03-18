import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { UserRow } from "~/components/admin/UserRow"
import { RevokedUserRow } from "~/components/admin/RevokedUserRow"
import { useAdminUsersMutation } from "~/components/admin/useAdminUsersMutation"
import { ActionBar, Button, Input, ScrollArea, Stack, Table, Text } from "@duro-app/ui"

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

interface RevokeTarget {
  id: string
  email: string
  displayName: string
}

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeReason, setRevokeReason] = useState("")
  const revokeMutation = useAdminUsersMutation()

  const { data: pageData, isLoading } = useQuery<AdminUsersData>({
    queryKey: ["admin-users"],
    queryFn: () => fetch("/admin/users-data").then((r) => r.json()),
  })

  if (isLoading || !pageData) {
    return (
      <Text as="p" color="muted">
        Loading...
      </Text>
    )
  }

  const { users, revocations, systemUserIds, certsByUser } = pageData

  const handleRevoke = (user: RevokeTarget) => {
    setRevokeTarget(user)
    setRevokeReason("")
    revokeMutation.reset()
  }

  const handleConfirmRevoke = () => {
    if (!revokeTarget) return
    const formData = new FormData()
    formData.set("intent", "revokeUser")
    formData.set("username", revokeTarget.id)
    formData.set("email", revokeTarget.email)
    formData.set("reason", revokeReason)
    revokeMutation.mutate(formData, {
      onSuccess: (data) => {
        if (data && "success" in data) {
          setRevokeTarget(null)
        }
      },
    })
  }

  return (
    <Stack gap="md">
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
                      onRevoke={handleRevoke}
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
      <ActionBar
        selectedItemCount={revokeTarget ? 1 : 0}
        selectedLabel={() =>
          t("admin.users.actions.revokeLabel", { user: revokeTarget?.displayName ?? revokeTarget?.id })
        }
        onClearSelection={() => setRevokeTarget(null)}
      >
        <Input
          name="reason"
          type="text"
          value={revokeReason}
          onChange={(e) => setRevokeReason((e.target as HTMLInputElement).value)}
          placeholder={t("admin.users.actions.reasonPlaceholder")}
        />
        <Button variant="danger" size="small" disabled={revokeMutation.isPending} onClick={handleConfirmRevoke}>
          {revokeMutation.isPending ? t("admin.users.actions.revoking") : t("admin.users.actions.confirmRevoke")}
        </Button>
      </ActionBar>

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
    </Stack>
  )
}
