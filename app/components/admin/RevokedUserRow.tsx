import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import { Button, Table } from "@duro-app/ui"

export function RevokedUserRow({ revocation }: { revocation: Revocation }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{revocation.email}</Table.Cell>
      <Table.Cell>{revocation.username}</Table.Cell>
      <Table.Cell>{revocation.reason ?? "\u2014"}</Table.Cell>
      <Table.Cell>{new Date(revocation.revokedAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>{revocation.revokedBy}</Table.Cell>
      <Table.Cell>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="reinviteRevoked" />
          <input type="hidden" name="revocationId" value={revocation.id} />
          <Button type="submit" variant="secondary" size="small" disabled={isSubmitting}>
            {isSubmitting ? t("admin.users.actions.processing") : t("admin.users.actions.reinvite")}
          </Button>
        </fetcher.Form>
      </Table.Cell>
    </Table.Row>
  )
}
