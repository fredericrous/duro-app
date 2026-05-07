import { useMemo, useState } from "react"
import { Form, redirect, useNavigation } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import type { Route } from "./+types/admin.grants.new"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { activateGrant } from "~/lib/workflows/grant-activation.server"
import type { Role } from "~/lib/governance/types"
import { Button, Combobox, Field, Inline, LinkButton, Select, Stack, Text, Input } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

// ---------------------------------------------------------------------------
// Loader: load apps, principals, roles-by-app, and ldap-provisioned app ids
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  if (!decision.allow) throw new Response("Forbidden", { status: 403 })

  const data = await runEffect(
    Effect.gen(function* () {
      const appRepo = yield* ApplicationRepo
      const principalRepo = yield* PrincipalRepo
      const rbac = yield* RbacRepo
      const connectedSystems = yield* ConnectedSystemRepo

      const applications = yield* appRepo.list()
      const principals = yield* principalRepo.list()

      // Roles per app — small N apps, one query each is fine.
      const rolesByApp: Record<string, Role[]> = {}
      const ldapAppIds: string[] = []
      for (const app of applications) {
        rolesByApp[app.id] = yield* rbac.listRoles(app.id)
        const plugin = yield* connectedSystems.findByApplicationAndType(app.id, "plugin")
        if (plugin && plugin.status === "active") ldapAppIds.push(app.id)
      }

      return { applications, principals, rolesByApp, ldapAppIds }
    }),
  )

  return data
}

// ---------------------------------------------------------------------------
// Action: create the grant, then redirect back to /admin/grants
// ---------------------------------------------------------------------------

function normalizeExpiresAt(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`
  return raw
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const auth = await getAuth(request)
  const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  if (!decision.allow || !auth.user) {
    throw new Response("Forbidden", { status: 403 })
  }

  const formData = await request.formData()
  const applicationId = formData.get("applicationId") as string
  const principalId = formData.get("principalId") as string
  const roleId = formData.get("roleId") as string
  const reason = (formData.get("reason") as string) || undefined
  const expiresAt = normalizeExpiresAt((formData.get("expiresAt") as string) || undefined)

  if (!applicationId || !principalId || !roleId) {
    return { error: "Application, principal, and role are required" }
  }

  try {
    await runEffect(
      Effect.gen(function* () {
        const principalRepo = yield* PrincipalRepo
        const actor = yield* principalRepo.findByExternalId(auth.user!)
        if (!actor) return yield* Effect.fail(new Error("Principal not found for current session"))

        const sql = yield* SqlClient.SqlClient
        const grantRepo = yield* GrantRepo
        const audit = yield* AuditService
        const grantId = yield* sql.withTransaction(
          Effect.gen(function* () {
            const grant = yield* grantRepo.grantRole({
              principalId,
              roleId,
              grantedBy: actor.id,
              reason,
              expiresAt,
            })
            yield* audit.emit({
              eventType: "grant.created",
              actorId: actor.id,
              targetType: "grant",
              targetId: grant.id,
              applicationId,
              metadata: { roleId, principalId, reason, expiresAt },
            })
            return grant.id
          }),
        )
        yield* activateGrant(grantId)
      }),
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create grant"
    return { error: message }
  }

  return redirect("/admin/grants")
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminGrantsNewPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { applications, principals, rolesByApp, ldapAppIds } = loaderData
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  // Auto-select when there is exactly one application.
  const [appId, setAppId] = useState<string>(() => (applications.length === 1 ? applications[0].id : ""))
  const [principalId, setPrincipalId] = useState<string>("")
  const [roleId, setRoleId] = useState<string>("")

  const ldapSet = useMemo(() => new Set(ldapAppIds), [ldapAppIds])
  const isLdapApp = appId !== "" && ldapSet.has(appId)

  // Group principals: when the chosen app is ldap-provisioned, only user
  // principals receive functional grants (group grants are phase 2).
  const visiblePrincipals = useMemo(
    () => (isLdapApp ? principals.filter((p) => p.principalType === "user") : principals),
    [principals, isLdapApp],
  )

  const principalLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const p of visiblePrincipals) {
      out[p.id] = `${p.displayName} (${p.principalType})${p.email ? ` — ${p.email}` : ""}`
    }
    return out
  }, [visiblePrincipals])

  const appLabels = useMemo<Record<string, string>>(
    () => Object.fromEntries(applications.map((a) => [a.id, `${a.displayName} (${a.slug})`])),
    [applications],
  )

  const roles: Role[] = appId ? (rolesByApp[appId] ?? []) : []

  // Switching application invalidates role (different role set) and may
  // invalidate principal (LDAP filter narrows visible set). Reset both in the
  // same handler so the form never carries stale ids.
  const handleAppChange = (next: string) => {
    setAppId(next)
    setRoleId("")
    setPrincipalId("")
  }

  const canSubmit = appId !== "" && roleId !== "" && principalId !== "" && !isSubmitting

  return (
    <CardSection title={t("admin.grants.new.title")}>
      <Form method="post">
        <Stack gap="md">
          {/* Application */}
          <Field.Root>
            <Field.Label>{t("admin.cols.application")}</Field.Label>
            <Combobox.Root
              name="applicationId"
              value={appId}
              onValueChange={(v) => handleAppChange(v ?? "")}
              initialLabels={appLabels}
            >
              <Combobox.Input placeholder={t("admin.cols.applicationPlaceholder")} />
              <Combobox.Popup>
                {applications.map((a) => (
                  <Combobox.Item key={a.id} value={a.id}>
                    {appLabels[a.id]}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
          </Field.Root>

          {/* Role — depends on chosen app */}
          <Field.Root>
            <Field.Label>{t("admin.cols.role")}</Field.Label>
            <Select.Root name="roleId" value={roleId} onValueChange={(v) => setRoleId(v ?? "")}>
              <Select.Trigger aria-label={t("admin.cols.role")}>
                <Select.Value
                  placeholder={appId ? t("admin.grants.new.rolePlaceholder") : t("admin.grants.new.pickAppFirst")}
                />
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
            {appId && roles.length === 0 && <Field.Description>{t("admin.grants.new.noRoles")}</Field.Description>}
          </Field.Root>

          {/* Principal */}
          <Field.Root>
            <Field.Label>{t("admin.cols.principal")}</Field.Label>
            <Combobox.Root
              name="principalId"
              value={principalId}
              onValueChange={(v) => setPrincipalId(v ?? "")}
              initialLabels={principalLabels}
            >
              <Combobox.Input placeholder={t("admin.grants.new.principalPlaceholder")} />
              <Combobox.Popup>
                {visiblePrincipals.map((p) => (
                  <Combobox.Item key={p.id} value={p.id}>
                    {principalLabels[p.id]}
                  </Combobox.Item>
                ))}
                <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
              </Combobox.Popup>
            </Combobox.Root>
            {isLdapApp && <Field.Description>{t("admin.grants.new.ldapNote")}</Field.Description>}
          </Field.Root>

          {/* Reason — optional */}
          <Field.Root>
            <Field.Label>{t("admin.grants.new.reasonLabel")}</Field.Label>
            <Input name="reason" placeholder={t("admin.grants.new.reasonPlaceholder")} />
          </Field.Root>

          {/* Expires — optional */}
          <Field.Root>
            <Field.Label>{t("admin.cols.expires")}</Field.Label>
            <Input name="expiresAt" type="date" />
            <Field.Description>{t("admin.grants.new.expiresHint")}</Field.Description>
          </Field.Root>

          {actionData && "error" in actionData && <Text color="error">{String(actionData.error)}</Text>}

          <Inline gap="sm" justify="end">
            <LinkButton href="/admin/grants" variant="secondary">
              {t("common.cancel")}
            </LinkButton>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isSubmitting ? t("admin.grants.new.creating") : t("admin.grants.createGrant")}
            </Button>
          </Inline>
        </Stack>
      </Form>
    </CardSection>
  )
}
