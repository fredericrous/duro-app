import { useTranslation } from "react-i18next"
import type { Revocation } from "~/lib/services/InviteRepo.server"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"
import { useAction } from "~/hooks/useAction"
import { Button } from "@duro-app/ui"

export function RevokedUserRow({ revocation }: { revocation: Revocation }) {
  const { t } = useTranslation()
  const action = useAction<AdminUsersResult>("/admin/users")
  const isSubmitting = action.state !== "idle"

  return (
    <tr>
      <td>{revocation.email}</td>
      <td>{revocation.username}</td>
      <td>{revocation.reason ?? "\u2014"}</td>
      <td>{new Date(revocation.revokedAt).toLocaleDateString()}</td>
      <td>{revocation.revokedBy}</td>
      <td>
        <action.Form>
          <input type="hidden" name="intent" value="reinviteRevoked" />
          <input type="hidden" name="revocationId" value={revocation.id} />
          <Button type="submit" variant="secondary" size="small" disabled={isSubmitting}>
            {isSubmitting ? t("admin.users.actions.processing") : t("admin.users.actions.reinvite")}
          </Button>
        </action.Form>
      </td>
    </tr>
  )
}
