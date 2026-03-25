import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.authz-playground"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import type { AccessDecision } from "~/lib/governance/types"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Alert, Button, Combobox, Field, Heading, Input, Panel, Stack, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader() {
  const [principals, applications] = await Promise.all([
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
  ])

  return { principals, applications }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

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
  const { principals, applications } = loaderData
  const fetcher = useFetcher()
  const [selectedSubject, setSelectedSubject] = useState("")
  const [selectedApp, setSelectedApp] = useState("")

  const isChecking = fetcher.state !== "idle"
  const result = fetcher.data as { decision: AccessDecision } | { error: string } | undefined

  return (
    <Stack gap="md">
      <html.div>
        <Heading level={2}>Authorization Playground</Heading>
        <Text color="muted">Test access checks against the authorization engine in real-time.</Text>
      </html.div>

      <Panel.Root bordered>
        <Panel.Body>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="checkAccess" />
            <Stack gap="md">
              <html.div>
                <Text>Principal</Text>
                <Combobox.Root value={selectedSubject} onValueChange={(v) => setSelectedSubject(v ?? "")}>
                  <Combobox.Input placeholder="Select a principal..." />
                  <Combobox.Popup>
                    {principals
                      .filter((p) => p.externalId)
                      .map((p) => (
                        <Combobox.Item key={p.id} value={p.externalId!}>
                          {p.displayName} ({p.externalId})
                        </Combobox.Item>
                      ))}
                    <Combobox.Empty>No results</Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
                <input type="hidden" name="subject" value={selectedSubject} />
              </html.div>

              <html.div>
                <Text>Application</Text>
                <Combobox.Root value={selectedApp} onValueChange={(v) => setSelectedApp(v ?? "")}>
                  <Combobox.Input placeholder="Select an application..." />
                  <Combobox.Popup>
                    {applications.map((app) => (
                      <Combobox.Item key={app.id} value={app.slug}>
                        {app.displayName} ({app.slug})
                      </Combobox.Item>
                    ))}
                    <Combobox.Empty>No results</Combobox.Empty>
                  </Combobox.Popup>
                </Combobox.Root>
                <input type="hidden" name="application" value={selectedApp} />
              </html.div>

              <Field.Root>
                <Field.Label>Action (entitlement slug)</Field.Label>
                <Input name="action" placeholder="e.g. read, write, admin" required />
              </Field.Root>
              <Field.Root>
                <Field.Label>Resource ID</Field.Label>
                <Input name="resourceId" placeholder="Optional resource ID" />
              </Field.Root>
              <Button type="submit" variant="primary" disabled={isChecking}>
                {isChecking ? "Checking..." : "Check Access"}
              </Button>
            </Stack>
          </fetcher.Form>
        </Panel.Body>
      </Panel.Root>

      {result && (
        <CardSection title="Result">
          {"error" in result ? (
            <Alert variant="error">{result.error}</Alert>
          ) : (
            <Stack gap="sm">
              <Alert variant={result.decision.allow ? "success" : "error"}>
                {result.decision.allow ? "ACCESS ALLOWED" : "ACCESS DENIED"}
              </Alert>
              <html.div style={styles.resultDetails}>
                <Text color="muted">Reasons:</Text>
                <html.ul>
                  {result.decision.reasons.map((reason, i) => (
                    <html.li key={i}>
                      <Text>{reason}</Text>
                    </html.li>
                  ))}
                </html.ul>
                {result.decision.matchedGrantIds.length > 0 && (
                  <>
                    <Text color="muted">Matched Grant IDs:</Text>
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
                    <Text color="muted">Diagnostics:</Text>
                    <html.ul>
                      <html.li>
                        <Text>Principal ID: {result.decision.diagnostics.principalId}</Text>
                      </html.li>
                      <html.li>
                        <Text>
                          Group IDs:{" "}
                          {result.decision.diagnostics.groupIds.length > 0
                            ? result.decision.diagnostics.groupIds.join(", ")
                            : "none"}
                        </Text>
                      </html.li>
                      <html.li>
                        <Text>Candidate grants: {result.decision.diagnostics.candidateGrantCount}</Text>
                      </html.li>
                      <html.li>
                        <Text>Evaluation time: {result.decision.diagnostics.evaluationMs}ms</Text>
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
