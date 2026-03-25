import { useFetcher } from "react-router"
import { Badge, Button, Checkbox, DetailPanel, List } from "@duro-app/ui"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import { certStatus } from "~/lib/cert-status"

function CertRevokeButton({ serialNumber, t }: { serialNumber: string; t: (key: string) => string }) {
  const fetcher = useFetcher()
  const isRevoking = fetcher.state !== "idle"

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="revokeCert" />
      <input type="hidden" name="serialNumber" value={serialNumber} />
      <Button type="submit" variant="danger" size="small" disabled={isRevoking}>
        {isRevoking ? t("admin.users.actions.revoking") : t("admin.users.certs.revokeCert")}
      </Button>
    </fetcher.Form>
  )
}

export function CertPanelContent({
  t,
  certPanelUser,
  certPanelUserId,
  certPanelCerts,
  selectedCerts,
  toggleCert,
  onClose,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string
  certPanelUser: { displayName: string } | undefined
  certPanelUserId: string
  certPanelCerts: UserCertificate[]
  selectedCerts: Set<string>
  toggleCert: (serialNumber: string) => void
  onClose: () => void
}) {
  return (
    <>
      <DetailPanel.Header>
        <DetailPanel.Title>
          {t("admin.users.actions.viewCerts")} — {certPanelUser?.displayName || certPanelUserId}
        </DetailPanel.Title>
        <DetailPanel.Close />
      </DetailPanel.Header>
      <DetailPanel.Body padded={false}>
        <List.Root selectionMode="multiple" aria-label={t("admin.users.actions.viewCerts")}>
          {certPanelCerts.map((cert) => {
            const status = certStatus(cert)
            const isActive = status === "active"
            return (
              <List.Item
                key={cert.id}
                selected={selectedCerts.has(cert.serialNumber)}
                disabled={!isActive}
                onClick={isActive ? () => toggleCert(cert.serialNumber) : undefined}
              >
                {isActive && (
                  <Checkbox
                    checked={selectedCerts.has(cert.serialNumber)}
                    onChange={() => toggleCert(cert.serialNumber)}
                    aria-label={cert.serialNumber}
                  />
                )}
                <List.Content>
                  <List.Text>{cert.serialNumber?.slice(0, 16)}...</List.Text>
                  <List.Description>
                    {t("admin.users.certs.issued")}: {new Date(cert.issuedAt).toLocaleDateString()} ·{" "}
                    {t("admin.users.certs.expires")}: {new Date(cert.expiresAt).toLocaleDateString()}
                  </List.Description>
                </List.Content>
                <List.Actions>
                  <Badge variant={isActive ? "success" : status === "expired" ? "default" : "error"} size="sm">
                    {t(`admin.users.certs.${status}`)}
                  </Badge>
                  {isActive && <CertRevokeButton serialNumber={cert.serialNumber} t={t} />}
                </List.Actions>
              </List.Item>
            )
          })}
          {certPanelCerts.length === 0 && <List.Empty>{t("admin.users.certs.empty")}</List.Empty>}
        </List.Root>
      </DetailPanel.Body>
    </>
  )
}
