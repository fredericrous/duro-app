import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Invite } from "~/lib/services/InviteRepo.server"
import type { AdminInvitesResult } from "~/lib/mutations/admin-invites"
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
  const queryClient = useQueryClient()

  const mutationOpts = {
    mutationFn: (formData: FormData) =>
      fetch("/admin/invites", { method: "POST", body: formData }).then((r) => r.json() as Promise<AdminInvitesResult>),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-invites"] }),
  }

  const revoke = useMutation(mutationOpts)
  const resend = useMutation(mutationOpts)

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
          <form
            onSubmit={(e) => {
              e.preventDefault()
              resend.mutate(new FormData(e.currentTarget))
            }}
          >
            <input type="hidden" name="intent" value="resend" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={resend.isPending || revoke.isPending}>
              {resend.isPending ? t("admin.invites.action.resending") : t("admin.invites.action.resend")}
            </Button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              revoke.mutate(new FormData(e.currentTarget))
            }}
          >
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="danger" size="small" disabled={revoke.isPending || resend.isPending}>
              {revoke.isPending ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}
