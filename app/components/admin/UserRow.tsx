import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import { certStatus } from "~/lib/cert-status"
import { useAdminUsersMutation } from "./useAdminUsersMutation"
import { AdminCertRow } from "./AdminCertRow"
import { RevokeAllButton } from "./RevokeAllButton"
import { Badge, Button, Inline, Stack, Table } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  fullRow: {
    gridColumn: "1 / -1",
  },
})

export function UserRow({
  user,
  isSystem,
  certs,
  onRevoke,
}: {
  user: { id: string; displayName: string; email: string; creationDate: string }
  isSystem: boolean
  certs: UserCertificate[]
  onRevoke?: (user: { id: string; email: string; displayName: string }) => void
}) {
  const { t } = useTranslation()
  const [showCerts, setShowCerts] = useState(false)
  const certMutation = useAdminUsersMutation()
  const revokeAllMutation = useAdminUsersMutation()
  const isSendingCert = certMutation.isPending
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
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  certMutation.mutate(new FormData(e.currentTarget))
                }}
              >
                <input type="hidden" name="intent" value="resendCert" />
                <input type="hidden" name="username" value={user.id} />
                <input type="hidden" name="email" value={user.email} />
                <Button type="submit" variant="secondary" size="small" disabled={isSendingCert}>
                  {isSendingCert ? t("admin.users.actions.sendingCert") : t("admin.users.actions.sendCert")}
                </Button>
              </form>
              {certs.length > 0 && (
                <Button type="button" variant="secondary" size="small" onClick={() => setShowCerts(!showCerts)}>
                  {t("admin.users.actions.viewCerts")}
                </Button>
              )}
              <Button
                type="button"
                variant="danger"
                size="small"
                onClick={() => onRevoke?.({ id: user.id, email: user.email, displayName: user.displayName })}
              >
                {t("admin.users.certs.revokeAll")}
              </Button>
            </Inline>
          )}
        </Table.Cell>
      </Table.Row>
      {showCerts && (
        <Table.Row>
          <html.div style={styles.fullRow}>
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
                <RevokeAllButton username={user.id} mutation={revokeAllMutation} />
              </Stack>
            )}
          </html.div>
        </Table.Row>
      )}
    </>
  )
}
