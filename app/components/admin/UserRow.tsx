import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"
import { certStatus } from "~/lib/cert-status"
import { useAction } from "~/hooks/useAction"
import { AdminCertRow } from "./AdminCertRow"
import { RevokeAllButton } from "./RevokeAllButton"
import { Badge, Button, Inline, Input } from "@duro-app/ui"
import s from "~/routes/admin.shared.module.css"

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
      <tr>
        <td>
          {user.id}
          {certs.length > 0 && (
            <>
              {" "}
              <Badge variant={activeCerts.length > 0 ? "success" : "default"}>
                {t("admin.users.certs.count", { count: activeCerts.length })}
              </Badge>
            </>
          )}
        </td>
        <td>{user.displayName}</td>
        <td>{user.email}</td>
        <td>{new Date(user.creationDate).toLocaleDateString()}</td>
        <td>
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
        </td>
      </tr>
      {isRevokeVisible && (
        <tr>
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
        </tr>
      )}
      {showCerts && (
        <tr>
          <td colSpan={5}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.users.certs.serial")}</th>
                  <th>{t("admin.users.certs.issued")}</th>
                  <th>{t("admin.users.certs.expires")}</th>
                  <th>{t("admin.users.certs.status")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((cert) => (
                  <AdminCertRow key={cert.id} cert={cert} />
                ))}
              </tbody>
            </table>
            {activeCerts.length > 1 && (
              <div style={{ marginTop: "0.5rem" }}>
                <RevokeAllButton username={user.id} action={revokeAllAction} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
