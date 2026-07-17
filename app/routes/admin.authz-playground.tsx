import { useState } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/admin.authz-playground"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import type { AccessDecision } from "~/lib/governance/types"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Alert, Button, Callout, Combobox, Heading, Panel, Stack, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const [principals, applications, entitlements, resources] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.list()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* ApplicationRepo
        return yield* repo.list()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listAllEntitlements()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        return yield* repo.listAllResources()
      }),
    ),
  ])

  // Actions and resources are per-application: the engine only allows an action
  // if the principal holds an entitlement whose slug equals that action on the
  // resolved app, and resources are scoped to their app. Group both by app slug
  // so the form can offer exactly the valid choices for the selected app rather
  // than making the admin guess free-text.
  const slugByAppId = new Map(applications.map((a) => [a.id, a.slug]))
  const actionsByApp: Record<string, string[]> = {}
  for (const e of entitlements) {
    const slug = slugByAppId.get(e.applicationId)
    if (!slug) continue
    ;(actionsByApp[slug] ??= []).push(e.slug)
  }
  const resourcesByApp: Record<string, Array<{ id: string; label: string }>> = {}
  for (const r of resources) {
    const slug = slugByAppId.get(r.applicationId)
    if (!slug) continue
    const label = r.path ? `${r.displayName} (${r.path})` : `${r.displayName} · ${r.resourceType}`
    ;(resourcesByApp[slug] ??= []).push({ id: r.id, label })
  }

  return { principals, applications, actionsByApp, resourcesByApp }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdminAction(request)

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "checkAccess") {
    const subject = formData.get("subject") as string
    const application = formData.get("application") as string
    const actionName = formData.get("action") as string
    const resourceId = (formData.get("resourceId") as string) || undefined

    if (!subject || !application || !actionName) {
      return { error: "Subject, application, and action are required" }
    }

    const decision = await runEffect(
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        return yield* engine.checkAccess({
          subject,
          application,
          action: actionName,
          resourceId,
        })
      }),
    )

    return { decision }
  }

  return { error: "Unknown intent" }
}

export default function AdminAuthzPlaygroundPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { principals, applications } = loaderData
  const actionsByApp = loaderData.actionsByApp ?? {}
  const resourcesByApp = loaderData.resourcesByApp ?? {}
  const fetcher = useFetcher()
  const [selectedSubject, setSelectedSubject] = useState("")
  const [selectedApp, setSelectedApp] = useState("")
  // Action + resource are scoped to the chosen app, so reset them whenever the
  // application changes (a stale action from another app would just deny).
  const [selectedAction, setSelectedAction] = useState("")
  const [selectedResource, setSelectedResource] = useState("")
  const appActions = actionsByApp[selectedApp] ?? []
  const appResources = resourcesByApp[selectedApp] ?? []

  const isChecking = fetcher.state !== "idle"
  const result = fetcher.data as { decision: AccessDecision } | { error: string } | undefined

  return (
    <Stack gap="md">
      <html.div>
        <Heading level={2}>
          {t("admin.authz.title")}
          <HelpPopover termKey="glossary.authzPlayground" />
        </Heading>
        <Text color="muted">{t("admin.authz.subtitle")}</Text>
      </html.div>

      <Callout variant="info" icon="check-circle">
        {t("admin.authz.readOnlyNotice")}
      </Callout>

      <Panel.Root bordered>
        <Panel.Body>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="checkAccess" />
            <Stack gap="md">
              <html.div>
                <Text>{t("admin.cols.principal")}</Text>
                <Combobox.Root value={selectedSubject} onValueChange={(v) => setSelectedSubject(v ?? "")}>
                  <Combobox.Input placeholder={t("admin.authz.principalPlaceholder")} />
                  <Combobox.Popup>
                    {principals
                      .filter((p) => p.externalId)
                      .map((p) => (
                        <Combobox.Item key={p.id} value={p.externalId!}>
                          {p.displayName} ({p.externalId})
                        </Combobox.Item>
                      ))}
                    <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
                <input type="hidden" name="subject" value={selectedSubject} />
              </html.div>

              <html.div>
                <Text>{t("admin.cols.application")}</Text>
                <Combobox.Root
                  value={selectedApp}
                  onValueChange={(v) => {
                    setSelectedApp(v ?? "")
                    setSelectedAction("")
                    setSelectedResource("")
                  }}
                >
                  <Combobox.Input placeholder={t("admin.authz.applicationPlaceholder")} />
                  <Combobox.Popup>
                    {applications.map((app) => (
                      <Combobox.Item key={app.id} value={app.slug}>
                        {app.displayName} ({app.slug})
                      </Combobox.Item>
                    ))}
                    <Combobox.Empty>{t("admin.principals.noResults")}</Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
                <input type="hidden" name="application" value={selectedApp} />
              </html.div>

              <html.div>
                <Text>{t("admin.authz.actionLabel")}</Text>
                <Combobox.Root value={selectedAction} onValueChange={(v) => setSelectedAction(v ?? "")}>
                  <Combobox.Input
                    placeholder={selectedApp ? t("admin.authz.actionPlaceholder") : t("admin.authz.selectAppFirst")}
                  />
                  <Combobox.Popup>
                    {appActions.map((a) => (
                      <Combobox.Item key={a} value={a}>
                        {a}
                      </Combobox.Item>
                    ))}
                    <Combobox.Empty>
                      {selectedApp ? t("admin.authz.actionNone") : t("admin.authz.selectAppFirst")}
                    </Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
                <input type="hidden" name="action" value={selectedAction} />
                <Text color="muted">{t("admin.authz.actionHint")}</Text>
              </html.div>

              <html.div>
                <Text>{t("admin.authz.resourceLabel")}</Text>
                <Combobox.Root value={selectedResource} onValueChange={(v) => setSelectedResource(v ?? "")}>
                  <Combobox.Input
                    placeholder={selectedApp ? t("admin.authz.resourcePlaceholder") : t("admin.authz.selectAppFirst")}
                  />
                  <Combobox.Popup>
                    {appResources.map((r) => (
                      <Combobox.Item key={r.id} value={r.id}>
                        {r.label}
                      </Combobox.Item>
                    ))}
                    <Combobox.Empty>
                      {selectedApp ? t("admin.authz.resourceNone") : t("admin.authz.selectAppFirst")}
                    </Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
                <input type="hidden" name="resourceId" value={selectedResource} />
                <Text color="muted">{t("admin.authz.resourceHint")}</Text>
              </html.div>
              <Button type="submit" variant="primary" disabled={isChecking}>
                {isChecking ? t("admin.authz.checking") : t("admin.authz.checkAccess")}
              </Button>
            </Stack>
          </fetcher.Form>
        </Panel.Body>
      </Panel.Root>

      {result && (
        <CardSection title={t("admin.authz.result")}>
          {"error" in result ? (
            <Alert variant="error">{result.error}</Alert>
          ) : (
            <Stack gap="sm">
              <Alert variant={result.decision.allow ? "success" : "error"}>
                {result.decision.allow ? t("admin.authz.allowed") : t("admin.authz.denied")}
              </Alert>
              <html.div style={styles.resultDetails}>
                <Text color="muted">{t("admin.authz.reasons")}</Text>
                <html.ul>
                  {result.decision.reasons.map((reason, i) => (
                    <html.li key={i}>
                      <Text>{reason}</Text>
                    </html.li>
                  ))}
                </html.ul>
                {result.decision.matchedGrantIds.length > 0 && (
                  <>
                    <Text color="muted">{t("admin.authz.matchedGrants")}</Text>
                    <html.ul>
                      {result.decision.matchedGrantIds.map((id) => (
                        <html.li key={id}>
                          <Text>{id}</Text>
                        </html.li>
                      ))}
                    </html.ul>
                  </>
                )}
                {result.decision.diagnostics && (
                  <>
                    <Text color="muted">{t("admin.authz.diagnostics")}</Text>
                    <html.ul>
                      <html.li>
                        <Text>
                          {t("admin.authz.principalId")}: {result.decision.diagnostics.principalId}
                        </Text>
                      </html.li>
                      <html.li>
                        <Text>
                          {t("admin.authz.groupIds")}:{" "}
                          {result.decision.diagnostics.groupIds.length > 0
                            ? result.decision.diagnostics.groupIds.join(", ")
                            : t("admin.authz.none")}
                        </Text>
                      </html.li>
                      <html.li>
                        <Text>
                          {t("admin.authz.candidateGrants")}: {result.decision.diagnostics.candidateGrantCount}
                        </Text>
                      </html.li>
                      <html.li>
                        <Text>{t("admin.authz.evaluationMs", { ms: result.decision.diagnostics.evaluationMs })}</Text>
                      </html.li>
                    </html.ul>
                  </>
                )}
              </html.div>
            </Stack>
          )}
        </CardSection>
      )}
    </Stack>
  )
}

const styles = css.create({
  resultDetails: {
    paddingTop: spacing.sm,
  },
})
