import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import { certStatus, statusVariant } from "~/lib/cert-status"
import { useAdminUsersMutation } from "./useAdminUsersMutation"
import { Badge, Button, Inline, Table } from "@duro-app/ui"

export function AdminCertRow({ cert }: { cert: UserCertificate }) {
  const { t } = useTranslation()
  const mutation = useAdminUsersMutation()
  const [confirming, setConfirming] = useState(false)
  const status = certStatus(cert)
  const revoked = mutation.data && "certRevoked" in mutation.data
  const effectiveStatus = revoked ? "revoked" : status

  return (
    <Table.Row>
      <Table.Cell>
        <code title={cert.serialNumber} style={{ fontFamily: "monospace" }}>
          {cert.serialNumber.slice(-8)}
        </code>
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
            <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)) }}>
              <input type="hidden" name="intent" value="revokeCert" />
              <input type="hidden" name="serialNumber" value={cert.serialNumber} />
              <Button type="submit" variant="danger" size="small" disabled={mutation.isPending}>
                {mutation.isPending ? t("admin.users.certs.pending") : t("admin.users.certs.revokeCert")}
              </Button>
            </form>
            <Button variant="secondary" size="small" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </Inline>
        )}
        {effectiveStatus === "failed" && (
          <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)) }}>
            <input type="hidden" name="intent" value="revokeCert" />
            <input type="hidden" name="serialNumber" value={cert.serialNumber} />
            <Button type="submit" variant="danger" size="small" disabled={mutation.isPending}>
              {t("admin.users.certs.failed")} — {t("admin.users.certs.revokeCert")}
            </Button>
          </form>
        )}
      </Table.Cell>
    </Table.Row>
  )
}
