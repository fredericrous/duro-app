import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"
import { certStatus, statusVariant } from "~/lib/cert-status"
import { useAction } from "~/hooks/useAction"
import { Badge, Button, Inline, Table } from "@duro-app/ui"

export function AdminCertRow({ cert }: { cert: UserCertificate }) {
  const { t } = useTranslation()
  const action = useAction<AdminUsersResult>("/admin/users")
  const [confirming, setConfirming] = useState(false)
  const isSubmitting = action.state !== "idle"
  const status = certStatus(cert)
  const revoked = action.data && "certRevoked" in action.data
  const effectiveStatus = revoked ? "revoked" : status

  return (
    <Table.Row>
      <Table.Cell>
        <code title={cert.serialNumber} style={{ fontFamily: "monospace" }}>{cert.serialNumber.slice(-8)}</code>
      </Table.Cell>
      <Table.Cell>{new Date(cert.issuedAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>{new Date(cert.expiresAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>
        <Badge variant={statusVariant(effectiveStatus)}>{t(`admin.users.certs.${effectiveStatus}`)}</Badge>
      </Table.Cell>
      <Table.Cell>
        {effectiveStatus === "active" && !confirming && (
          <Button variant="danger" size="small" onClick={() => setConfirming(true)}>
            {t("admin.users.certs.revokeCert")}
          </Button>
        )}
        {effectiveStatus === "active" && confirming && (
          <Inline gap="sm">
            <action.Form>
              <input type="hidden" name="intent" value="revokeCert" />
              <input type="hidden" name="serialNumber" value={cert.serialNumber} />
              <Button type="submit" variant="danger" size="small" disabled={isSubmitting}>
                {isSubmitting ? t("admin.users.certs.pending") : t("admin.users.certs.revokeCert")}
              </Button>
            </action.Form>
            <Button variant="secondary" size="small" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </Inline>
        )}
        {effectiveStatus === "failed" && (
          <action.Form>
            <input type="hidden" name="intent" value="revokeCert" />
            <input type="hidden" name="serialNumber" value={cert.serialNumber} />
            <Button type="submit" variant="danger" size="small" disabled={isSubmitting}>
              {t("admin.users.certs.failed")} — {t("admin.users.certs.revokeCert")}
            </Button>
          </action.Form>
        )}
      </Table.Cell>
    </Table.Row>
  )
}
