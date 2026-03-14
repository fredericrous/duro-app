import { useTranslation } from "react-i18next"
import type { Invite } from "~/lib/services/InviteRepo.server"
import type { AdminInvitesResult } from "~/lib/mutations/admin-invites"
import { useAction } from "~/hooks/useAction"
import { Button, Inline, Table, Text } from "@duro-app/ui"

export function FailedInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const retryAction = useAction<AdminInvitesResult>("/admin/invites")
  const revokeAction = useAction<AdminInvitesResult>("/admin/invites")
  const isRetrying = retryAction.state !== "idle"
  const isRevoking = revokeAction.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{invite.email}</Table.Cell>
      <Table.Cell>
        <Text variant="bodySm" color="error">{invite.lastError ?? "Unknown error"}</Text>
      </Table.Cell>
      <Table.Cell>{invite.failedAt ? new Date(invite.failedAt).toLocaleString() : "\u2014"}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <retryAction.Form>
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={isRetrying || isRevoking}>
              {isRetrying ? t("admin.invites.action.retrying") : t("admin.invites.action.retry")}
            </Button>
          </retryAction.Form>
          <revokeAction.Form>
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="danger" size="small" disabled={isRevoking || isRetrying}>
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </revokeAction.Form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}
