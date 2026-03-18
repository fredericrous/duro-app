import { useTranslation } from "react-i18next"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import { useAdminUsersMutation } from "./useAdminUsersMutation"
import { Button, Table } from "@duro-app/ui"

export function RevokedUserRow({ revocation }: { revocation: Revocation }) {
  const { t } = useTranslation()
  const mutation = useAdminUsersMutation()

  return (
    <Table.Row>
      <Table.Cell>{revocation.email}</Table.Cell>
      <Table.Cell>{revocation.username}</Table.Cell>
      <Table.Cell>{revocation.reason ?? "\u2014"}</Table.Cell>
      <Table.Cell>{new Date(revocation.revokedAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>{revocation.revokedBy}</Table.Cell>
      <Table.Cell>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate(new FormData(e.currentTarget))
          }}
        >
          <input type="hidden" name="intent" value="reinviteRevoked" />
          <input type="hidden" name="revocationId" value={revocation.id} />
          <Button type="submit" variant="secondary" size="small" disabled={mutation.isPending}>
            {mutation.isPending ? t("admin.users.actions.processing") : t("admin.users.actions.reinvite")}
          </Button>
        </form>
      </Table.Cell>
    </Table.Row>
  )
}
