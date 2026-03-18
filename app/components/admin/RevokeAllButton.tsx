import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { UseMutationResult } from "@tanstack/react-query"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"
import { Button, Inline } from "@duro-app/ui"

export function RevokeAllButton({
  username,
  mutation,
}: {
  username: string
  mutation: UseMutationResult<AdminUsersResult, Error, FormData>
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const done = mutation.data && typeof mutation.data === "object" && "certsRevoked" in mutation.data

  if (done) return null

  if (confirming) {
    return (
      <Inline gap="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate(new FormData(e.currentTarget))
          }}
        >
          <input type="hidden" name="intent" value="revokeAllCerts" />
          <input type="hidden" name="username" value={username} />
          <Button type="submit" variant="danger" size="small" disabled={mutation.isPending}>
            {mutation.isPending ? t("admin.users.certs.pending") : t("admin.users.certs.revokeAll")}
          </Button>
        </form>
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
