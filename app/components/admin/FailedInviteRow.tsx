import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Invite } from "~/lib/services/InviteRepo.server"
import type { AdminInvitesResult } from "~/lib/mutations/admin-invites"
import { Button, Inline, Table, Text } from "@duro-app/ui"

export function FailedInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const mutationOpts = {
    mutationFn: (formData: FormData) =>
      fetch("/admin/invites", { method: "POST", body: formData }).then((r) => r.json() as Promise<AdminInvitesResult>),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-invites"] }),
  }

  const retry = useMutation(mutationOpts)
  const revoke = useMutation(mutationOpts)

  return (
    <Table.Row>
      <Table.Cell>{invite.email}</Table.Cell>
      <Table.Cell>
        <Text variant="bodySm" color="error">
          {invite.lastError ?? "Unknown error"}
        </Text>
      </Table.Cell>
      <Table.Cell>{invite.failedAt ? new Date(invite.failedAt).toLocaleString() : "\u2014"}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              retry.mutate(new FormData(e.currentTarget))
            }}
          >
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={retry.isPending || revoke.isPending}>
              {retry.isPending ? t("admin.invites.action.retrying") : t("admin.invites.action.retry")}
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
            <Button type="submit" variant="danger" size="small" disabled={revoke.isPending || retry.isPending}>
              {revoke.isPending ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}
