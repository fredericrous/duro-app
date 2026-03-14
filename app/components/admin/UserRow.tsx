import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"
import { certStatus } from "~/lib/cert-status"
import { useAction } from "~/hooks/useAction"
import { AdminCertRow } from "./AdminCertRow"
import { RevokeAllButton } from "./RevokeAllButton"
import { Badge, Button, Inline, Input, Stack, Table } from "@duro-app/ui"

const API_URL = "/admin/users"

export function UserRow({
  user,
  isSystem,
  certs,
}: {
  user: { id: string; displayName: string; email: string; creationDate: string }
  isSystem: boolean
  certs: UserCertificate[]
}) {
  const { t } = useTranslation()
  const [showRevoke, setShowRevoke] = useState(false)
  const [showCerts, setShowCerts] = useState(false)
  const certAction = useAction<AdminUsersResult>(API_URL)
  const revokeAction = useAction<AdminUsersResult>(API_URL)
  const revokeAllAction = useAction<AdminUsersResult>(API_URL)
  const isSendingCert = certAction.state !== "idle"
  const isRevoking = revokeAction.state !== "idle"
  const revokeSucceeded = revokeAction.data && "success" in revokeAction.data
  const isRevokeVisible = showRevoke && !revokeSucceeded
  const activeCerts = certs.filter((c) => certStatus(c) === "active")

  return (
    <>
      <Table.Row>
        <Table.Cell>
          {user.id}
          {certs.length > 0 && (
            <>
              {" "}
              <Badge variant={activeCerts.length > 0 ? "success" : "default"}>
                {t("admin.users.certs.count", { count: activeCerts.length })}
              </Badge>
            </>
          )}
        </Table.Cell>
        <Table.Cell>{user.displayName}</Table.Cell>
        <Table.Cell>{user.email}</Table.Cell>
        <Table.Cell>{new Date(user.creationDate).toLocaleDateString()}</Table.Cell>
        <Table.Cell>
          {!isSystem && (
            <Inline gap="sm">
              <certAction.Form>
                <input type="hidden" name="intent" value="resendCert" />
                <input type="hidden" name="username" value={user.id} />
                <input type="hidden" name="email" value={user.email} />
                <Button type="submit" variant="secondary" size="small" disabled={isSendingCert || isRevoking}>
                  {isSendingCert ? t("admin.users.actions.sendingCert") : t("admin.users.actions.sendCert")}
                </Button>
              </certAction.Form>
              {certs.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => setShowCerts(!showCerts)}
                >
                  {t("admin.users.actions.viewCerts")}
                </Button>
              )}
              <Button
                type="button"
                variant="danger"
                size="small"
                disabled={isRevoking}
                onClick={() => setShowRevoke(!showRevoke)}
              >
                {t("admin.users.actions.revoke")}
              </Button>
            </Inline>
          )}
        </Table.Cell>
      </Table.Row>
      {isRevokeVisible && (
        <Table.Row>
          <td colSpan={5}>
            <revokeAction.Form>
              <Inline gap="sm" align="center">
                <input type="hidden" name="intent" value="revokeUser" />
                <input type="hidden" name="username" value={user.id} />
                <input type="hidden" name="email" value={user.email} />
                <Input name="reason" type="text" placeholder={t("admin.users.actions.reasonPlaceholder")} />
                <Button type="submit" variant="danger" disabled={isRevoking}>
                  {isRevoking ? t("admin.users.actions.revoking") : t("admin.users.actions.confirmRevoke")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowRevoke(false)}>
                  {t("common.cancel")}
                </Button>
              </Inline>
            </revokeAction.Form>
          </td>
        </Table.Row>
      )}
      {showCerts && (
        <Table.Row>
          <td colSpan={5}>
            <Table.Root columns={5}>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("admin.users.certs.serial")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("admin.users.certs.issued")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("admin.users.certs.expires")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("admin.users.certs.status")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("common.actions")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {certs.map((cert) => (
                  <AdminCertRow key={cert.id} cert={cert} />
                ))}
              </Table.Body>
            </Table.Root>
            {activeCerts.length > 1 && (
              <Stack gap="sm">
                <RevokeAllButton username={user.id} action={revokeAllAction} />
              </Stack>
            )}
          </td>
        </Table.Row>
      )}
    </>
  )
}
