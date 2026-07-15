import { useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/admin.invitations"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { AccessInvitationRepo, type AccessInvitationEnriched } from "~/lib/governance/AccessInvitationRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { cancelInvitation } from "~/lib/workflows/access-invitation.server"
import type { Role, Entitlement } from "~/lib/governance/types"
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Select, Stack, Table, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

const DEFAULT_EXPIRY_DAYS = 14

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const data = await runEffect(
    Effect.gen(function* () {
      const appRepo = yield* ApplicationRepo
      const principalRepo = yield* PrincipalRepo
      const rbac = yield* RbacRepo
      const invRepo = yield* AccessInvitationRepo

      // Settle stale invitations before listing so the table (and the admin
      // pending-count badge) reflect reality.
      yield* invRepo.markExpired()

      const applications = yield* appRepo.list()
      const principals = yield* principalRepo.list()

      const rolesByApp: Record<string, Role[]> = {}
      const entitlementsByApp: Record<string, Entitlement[]> = {}
      for (const app of applications) {
        rolesByApp[app.id] = yield* rbac.listRoles(app.id)
        entitlementsByApp[app.id] = yield* rbac.listEntitlements(app.id)
      }

      const invitations = yield* invRepo.listAllEnriched()
      return { invitations, applications, principals, rolesByApp, entitlementsByApp }
    }),
  )

  return data
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdminAction(request)

  // invited_by / actor are FK to principals(id), so resolve the admin's OIDC
  // subject to a governance principal — passing the display name FK-violates.
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)
  const admin = auth.sub
    ? await runEffect(
        Effect.gen(function* () {
          const repo = yield* PrincipalRepo
          return yield* repo.findByExternalId(auth.sub!)
        }),
      )
    : null
  if (!admin) return { error: "principal_not_found" as const }

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "createInvitation") {
    const applicationId = (formData.get("applicationId") as string)?.trim()
    const invitedPrincipalId = (formData.get("invitedPrincipalId") as string)?.trim()
    const roleId = ((formData.get("roleId") as string) || "").trim() || undefined
    const entitlementId = ((formData.get("entitlementId") as string) || "").trim() || undefined
    const message = ((formData.get("message") as string) || "").trim() || undefined
    const expiresAtRaw = ((formData.get("expiresAt") as string) || "").trim()

    if (!applicationId || !invitedPrincipalId) return { error: "app_and_principal_required" as const }
    // Exactly one target — an invitation must describe a concrete grant so that
    // accepting it materialises access (the glossary's promise).
    if (!roleId && !entitlementId) return { error: "target_required" as const }
    if (roleId && entitlementId) return { error: "target_exclusive" as const }

    const expiresAt = expiresAtRaw
      ? /^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw)
        ? `${expiresAtRaw}T00:00:00.000Z`
        : expiresAtRaw
      : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const result = await runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessInvitationRepo
        yield* repo.create({
          applicationId,
          invitedPrincipalId,
          invitedBy: admin.id,
          roleId,
          entitlementId,
          message,
          expiresAt,
        })
        return { ok: true as const }
      }).pipe(
        Effect.catchAll((e) => {
          console.error("[admin.invitations] create failed:", e)
          return Effect.succeed({ ok: false as const })
        }),
      ),
    )
    return result.ok ? { success: "created" as const } : { error: "create_failed" as const }
  }

  if (intent === "cancelInvitation") {
    const invitationId = (formData.get("invitationId") as string)?.trim()
    if (!invitationId) return { error: "missing_invitation_id" as const }

    const result = await runEffect(
      cancelInvitation({ invitationId, adminPrincipalId: admin.id }).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTag("AccessInvitationError", (e) => Effect.succeed({ ok: false as const, code: e.code })),
        Effect.catchAll(() => Effect.succeed({ ok: false as const, code: "db" as const })),
      ),
    )
    return result.ok ? { success: "cancelled" as const } : { error: result.code }
  }

  return { error: "unknown_intent" as const }
}

const statusBadge = (status: string): "default" | "success" | "warning" | "error" => {
  if (status === "pending") return "warning"
  if (status === "accepted") return "success"
  if (status === "declined") return "error"
  return "default"
}

export default function AdminInvitationsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { invitations, applications, principals, rolesByApp, entitlementsByApp } = loaderData
  const fetcher = useFetcher<typeof action>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedApp, setSelectedApp] = useState<string>("")

  const busy = fetcher.state !== "idle"
  const data = (fetcher.data ?? null) as { success?: string; error?: string } | null

  const roles = useMemo(() => (selectedApp ? (rolesByApp[selectedApp] ?? []) : []), [selectedApp, rolesByApp])
  const entitlements = useMemo(
    () => (selectedApp ? (entitlementsByApp[selectedApp] ?? []) : []),
    [selectedApp, entitlementsByApp],
  )

  return (
    <Stack gap="md">
      {data?.success && (
        <Alert variant="success">
          {t(`admin.invitations.success.${data.success}`, { defaultValue: "" }) as string}
        </Alert>
      )}
      {data?.error && (
        <Alert variant="error">
          {t(`admin.invitations.error.${data.error}`, { defaultValue: t("admin.invitations.error.generic") }) as string}
        </Alert>
      )}

      <CardSection
        title={t("admin.invitations.title", { n: invitations.length })}
        action={
          <Button variant="primary" size="small" onClick={() => setDialogOpen(true)}>
            {t("admin.invitations.create")}
          </Button>
        }
      >
        {invitations.length === 0 ? (
          <EmptyState message={t("admin.invitations.empty")} />
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("admin.invitations.cols.status")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invitations.cols.application")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invitations.cols.invitedPrincipal")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invitations.cols.access")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invitations.cols.invitedBy")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invitations.cols.created")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invitations.cols.action")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invitations.map((inv: AccessInvitationEnriched) => (
                <Table.Row key={inv.id}>
                  <Table.Cell>
                    <Badge variant={statusBadge(inv.status)}>
                      {t(`admin.invitations.status.${inv.status}`, { defaultValue: inv.status }) as string}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{inv.applicationName || inv.applicationId}</Table.Cell>
                  <Table.Cell>{inv.invitedPrincipalName || inv.invitedPrincipalId}</Table.Cell>
                  <Table.Cell>{inv.roleName ?? inv.entitlementName ?? <Text color="muted">—</Text>}</Table.Cell>
                  <Table.Cell>{inv.invitedByName ?? <Text color="muted">—</Text>}</Table.Cell>
                  <Table.Cell>{new Date(inv.createdAt).toLocaleDateString()}</Table.Cell>
                  <Table.Cell>
                    {inv.status === "pending" && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="cancelInvitation" />
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <Button type="submit" variant="secondary" size="small" disabled={busy}>
                          {t("admin.invitations.cancel")}
                        </Button>
                      </fetcher.Form>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </CardSection>

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Header>
            <Dialog.Title>{t("admin.invitations.dialog.title")}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <fetcher.Form method="post" onSubmit={() => setTimeout(() => setDialogOpen(false), 0)}>
              <input type="hidden" name="intent" value="createInvitation" />
              <Stack gap="md">
                <Field.Root>
                  <Field.Label>{t("admin.invitations.dialog.application")}</Field.Label>
                  <Select.Root name="applicationId" onValueChange={(v) => setSelectedApp(String(v ?? ""))}>
                    <Select.Trigger aria-label={t("admin.invitations.dialog.application")}>
                      <Select.Value placeholder={t("admin.invitations.dialog.applicationPlaceholder")} />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {applications.map((app) => (
                        <Select.Item key={app.id} value={app.id}>
                          <Select.ItemText>{app.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.invitations.dialog.principal")}</Field.Label>
                  <Select.Root name="invitedPrincipalId">
                    <Select.Trigger aria-label={t("admin.invitations.dialog.principal")}>
                      <Select.Value placeholder={t("admin.invitations.dialog.principalPlaceholder")} />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {principals.map((p) => (
                        <Select.Item key={p.id} value={p.id}>
                          <Select.ItemText>{p.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.invitations.dialog.role")}</Field.Label>
                  <Select.Root name="roleId">
                    <Select.Trigger aria-label={t("admin.invitations.dialog.role")}>
                      <Select.Value placeholder={t("admin.invitations.dialog.rolePlaceholder")} />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {roles.map((r) => (
                        <Select.Item key={r.id} value={r.id}>
                          <Select.ItemText>{r.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.invitations.dialog.entitlement")}</Field.Label>
                  <Select.Root name="entitlementId">
                    <Select.Trigger aria-label={t("admin.invitations.dialog.entitlement")}>
                      <Select.Value placeholder={t("admin.invitations.dialog.entitlementPlaceholder")} />
                      <Select.Icon />
                    </Select.Trigger>
                    <Select.Popup>
                      {entitlements.map((e) => (
                        <Select.Item key={e.id} value={e.id}>
                          <Select.ItemText>{e.displayName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Popup>
                  </Select.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.invitations.dialog.message")}</Field.Label>
                  <Input name="message" placeholder={t("admin.invitations.dialog.messagePlaceholder")} />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("admin.invitations.dialog.expiresAt")}</Field.Label>
                  <Input name="expiresAt" type="date" />
                  <Field.Description>
                    {t("admin.invitations.dialog.expiresHint", { days: DEFAULT_EXPIRY_DAYS })}
                  </Field.Description>
                </Field.Root>
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? t("admin.invitations.dialog.creating") : t("admin.invitations.dialog.submit")}
                </Button>
              </Stack>
            </fetcher.Form>
          </Dialog.Body>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  )
}
