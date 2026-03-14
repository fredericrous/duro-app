import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UseActionReturn } from "~/hooks/useAction"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"
import { Button, Inline } from "@duro-app/ui"

export function RevokeAllButton({
  username,
  action,
}: {
  username: string
  action: UseActionReturn<AdminUsersResult>
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const isSubmitting = action.state !== "idle"
  const done = action.data && typeof action.data === "object" && "certsRevoked" in action.data

  if (done) return null

  if (confirming) {
    return (
      <Inline gap="sm">
        <action.Form>
          <input type="hidden" name="intent" value="revokeAllCerts" />
          <input type="hidden" name="username" value={username} />
          <Button type="submit" variant="danger" size="small" disabled={isSubmitting}>
            {isSubmitting ? t("admin.users.certs.pending") : t("admin.users.certs.revokeAll")}
          </Button>
        </action.Form>
        <Button variant="secondary" size="small" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </Button>
      </Inline>
    )
  }

  return (
    <Button variant="danger" size="small" onClick={() => setConfirming(true)}>
      {t("admin.users.certs.revokeAll")}
    </Button>
  )
}
