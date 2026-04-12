import { useFetcher } from "react-router"
import { useEffect, useMemo } from "react"
import {
  Button,
  Combobox,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Stack,
  Text,
} from "@duro-app/ui"
import type { Principal, Role } from "~/lib/governance/types"

interface QuickGrantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: ReadonlyArray<Role>
  principals: ReadonlyArray<Principal>
  applicationSlug: string
  ldapProvisioned: boolean
  onGoToRoles: () => void
}

export function QuickGrantDialog({
  open,
  onOpenChange,
  roles,
  principals,
  applicationSlug,
  ldapProvisioned,
  onGoToRoles,
}: QuickGrantDialogProps) {
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== "idle"

  // For LDAP-provisioned apps, only user principals can receive grants that
  // actually do something. Group principals stay DB-only until phase 2.
  const visiblePrincipals = useMemo(
    () => (ldapProvisioned ? principals.filter((p) => p.principalType === "user") : principals),
    [principals, ldapProvisioned],
  )

  const principalLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const p of visiblePrincipals) {
      out[p.id] = `${p.displayName} (${p.principalType})${p.email ? ` — ${p.email}` : ""}`
    }
    return out
  }, [visiblePrincipals])

  // Close dialog after a successful submission
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "success" in fetcher.data) {
      onOpenChange(false)
    }
  }, [fetcher.state, fetcher.data, onOpenChange])

  const noRoles = roles.length === 0
  const noPrincipals = visiblePrincipals.length === 0
  const blocked = noRoles || noPrincipals

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Header>
          <Dialog.Title>Grant access</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <Dialog.Body>
          {noRoles && (
            <EmptyState
              message="Create at least one role on this application before granting access."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    onOpenChange(false)
                    onGoToRoles()
                  }}
                >
                  Go to Roles
                </Button>
              }
            />
          )}
          {!noRoles && noPrincipals && (
            <EmptyState
              message={
                ldapProvisioned
                  ? "No user principals available. Group-backed grants for provisioned apps arrive in phase 2."
                  : "No users or groups found. Sync your identity provider or create a principal first."
              }
            />
          )}
          {!blocked && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="createGrant" />
              <Stack gap="md">
                {ldapProvisioned && (
                  <Text color="muted">
                    Group grants for provisioned apps arrive in phase 2 — only user principals are offered here.
                  </Text>
                )}
                <Field.Root>
                  <Field.Label>Principal</Field.Label>
                  <Combobox.Root name="principalId" initialLabels={principalLabels}>
                    <Combobox.Input placeholder="Search users…" />
                    <Combobox.Popup>
                      {visiblePrincipals.map((p) => (
                        <Combobox.Item key={p.id} value={p.id}>
                          {principalLabels[p.id]}
                        </Combobox.Item>
                      ))}
                      <Combobox.Empty>No matches</Combobox.Empty>
                    </Combobox.Popup>
                  </Combobox.Root>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Role</Field.Label>
                  <Select.Root name="roleId">
                    <Select.Trigger aria-label="Role">
                      <Select.Value placeholder="Pick a role" />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {roles.map((r) => (
                        <Select.Item key={r.id} value={r.id}>
                          <Select.ItemText>
                            {r.displayName} ({r.slug})
                          </Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Reason (optional)</Field.Label>
                  <Input name="reason" placeholder="Why is this grant being created?" />
                </Field.Root>

                <Field.Root>
                  <Field.Label>Expires</Field.Label>
                  <Input name="expiresAt" type="date" />
                  <Field.Description>
                    Local date. The grant expires at midnight UTC on the chosen day.
                  </Field.Description>
                </Field.Root>

                {fetcher.data && "error" in fetcher.data && (
                  <Text color="error">{String(fetcher.data.error)}</Text>
                )}

                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Granting…" : "Grant access"}
                </Button>
              </Stack>
            </fetcher.Form>
          )}
        </Dialog.Body>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
