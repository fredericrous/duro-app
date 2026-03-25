import { useFetcher } from "react-router"
import { Button, ButtonGroup } from "@duro-app/ui"
import type { UserData, RevokeTarget } from "./UserColumns"

export function ActionCell({
  row,
  certPanelUserId,
  onRevoke,
  onViewCerts,
  t,
}: {
  row: UserData
  certPanelUserId: string | null
  onRevoke: (user: RevokeTarget) => void
  onViewCerts: (userId: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const certFetcher = useFetcher()
  const isSendingCert = certFetcher.state !== "idle"
  const { id, email, displayName, isSystem, activeCertCount, certs } = row
  const isPanelOpen = certPanelUserId === id

  if (isSystem) return null

  return (
    <ButtonGroup gap="xs">
      <certFetcher.Form method="post">
        <input type="hidden" name="intent" value="resendCert" />
        <input type="hidden" name="username" value={id} />
        <input type="hidden" name="email" value={email} />
        <Button type="submit" variant="secondary" size="small" disabled={isSendingCert}>
          {isSendingCert ? t("admin.users.actions.sendingCert") : t("admin.users.actions.sendCert")}
        </Button>
      </certFetcher.Form>
      {certs.length > 0 && (
        <Button
          type="button"
          variant={isPanelOpen ? "primary" : "secondary"}
          size="small"
          onClick={() => onViewCerts(id)}
        >
          {t("admin.users.actions.viewCerts")}
        </Button>
      )}
      <Button
        type="button"
        variant="danger"
        size="small"
        onClick={() => onRevoke({ id, email, displayName })}
      >
        {activeCertCount > 0 ? t("admin.users.certs.revokeAll") : t("admin.users.actions.revoke")}
      </Button>
    </ButtonGroup>
  )
}
