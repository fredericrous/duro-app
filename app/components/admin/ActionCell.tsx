import { useFetcher } from "react-router"
import { Alert, Button, ButtonGroup, Stack } from "@duro-app/ui"
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

  // Surface the "Send Cert" outcome inline, derived straight from the fetcher.
  // resendCert awaits the email send, so `success` means the renewal mail
  // actually went out and `error` carries the failure reason (both shaped by
  // handleAdminUsersMutation). Hidden while a send is in flight; the last
  // result stays visible until the next send so the admin has a lasting
  // confirmation of who was mailed.
  const result = isSendingCert ? undefined : (certFetcher.data as Record<string, unknown> | undefined)
  const feedback = result
    ? "error" in result
      ? { variant: "error" as const, message: t("admin.users.actions.certSendFailed", { error: String(result.error) }) }
      : "success" in result
        ? { variant: "success" as const, message: t("admin.users.actions.certSent") }
        : null
    : null

  if (isSystem) return null

  return (
    <Stack gap="xs">
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
        <Button type="button" variant="danger" size="small" onClick={() => onRevoke({ id, email, displayName })}>
          {activeCertCount > 0 ? t("admin.users.certs.revokeAll") : t("admin.users.actions.revoke")}
        </Button>
      </ButtonGroup>
      {feedback && <Alert variant={feedback.variant}>{feedback.message}</Alert>}
    </Stack>
  )
}
