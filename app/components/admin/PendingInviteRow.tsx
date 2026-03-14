import { useTranslation } from "react-i18next"
import type { Invite } from "~/lib/services/InviteRepo.server"
import type { AdminInvitesResult } from "~/lib/mutations/admin-invites"
import { useAction } from "~/hooks/useAction"
import { Badge, Button, Inline, Table } from "@duro-app/ui"

function StepBadges({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  if (invite.failedAt) return <Badge variant="error">{t("admin.invites.badge.failed")}</Badge>
  if (invite.emailSent) return <Badge variant="success">{t("admin.invites.badge.sent")}</Badge>
  if (invite.certIssued) return <Badge variant="success">{t("admin.invites.badge.certIssued")}</Badge>
  return <Badge variant="warning">{t("admin.invites.badge.processing")}</Badge>
}

export function PendingInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const revokeAction = useAction<AdminInvitesResult>("/admin/invites")
  const resendAction = useAction<AdminInvitesResult>("/admin/invites")
  const isRevoking = revokeAction.state !== "idle"
  const isResending = resendAction.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{invite.email}</Table.Cell>
      <Table.Cell>{JSON.parse(invite.groupNames).join(", ")}</Table.Cell>
      <Table.Cell>
        <StepBadges invite={invite} />
      </Table.Cell>
      <Table.Cell>{invite.invitedBy}</Table.Cell>
      <Table.Cell>{new Date(invite.expiresAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <resendAction.Form>
            <input type="hidden" name="intent" value="resend" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={isResending || isRevoking}>
              {isResending ? t("admin.invites.action.resending") : t("admin.invites.action.resend")}
            </Button>
          </resendAction.Form>
          <revokeAction.Form>
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="danger" size="small" disabled={isRevoking || isResending}>
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </revokeAction.Form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}
