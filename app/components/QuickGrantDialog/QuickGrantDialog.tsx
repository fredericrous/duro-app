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
  onGoToRoles: () => void
}

export function QuickGrantDialog({
  open,
  onOpenChange,
  roles,
  principals,
  onGoToRoles,
}: QuickGrantDialogProps) {
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== "idle"

  const principalLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const p of principals) {
      out[p.id] = `${p.displayName} (${p.principalType})${p.email ? ` — ${p.email}` : ""}`
    }
    return out
  }, [principals])

  // Close dialog after a successful submission
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "success" in fetcher.data) {
      onOpenChange(false)
    }
  }, [fetcher.state, fetcher.data, onOpenChange])

  const noRoles = roles.length === 0
  const noPrincipals = principals.length === 0
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
            <EmptyState message="No users or groups found. Sync your identity provider or create a principal first." />
          )}
          {!blocked && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="createGrant" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>Principal</Field.Label>
                  <Combobox.Root name="principalId" initialLabels={principalLabels}>
                    <Combobox.Input placeholder="Search users or groups…" />
                    <Combobox.Popup>
                      {principals.map((p) => (
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
