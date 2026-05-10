import { Effect } from "effect"
import { useFetcher, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/requests"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { AccessRequestRepo, type AccessRequestEnriched } from "~/lib/governance/AccessRequestRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { cancelOwnAccessRequest } from "~/lib/workflows/access-request.server"
import { Header } from "~/components/Header/Header"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"
import { Alert, Badge, Button, EmptyState, PageShell, ScrollArea, Stack, Table, Text } from "@duro-app/ui"

export function meta() {
  return [{ title: "My requests - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)
  if (!auth.user || !auth.sub) {
    return { requests: [] as AccessRequestEnriched[] }
  }

  const requests = await runEffect(
    Effect.gen(function* () {
      const principalRepo = yield* PrincipalRepo
      const principal = yield* principalRepo.findByExternalId(auth.sub!)
      if (!principal) return [] as AccessRequestEnriched[]
      const repo = yield* AccessRequestRepo
      return yield* repo.listForRequesterEnriched(principal.id)
    }),
  )

  return { requests }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return Response.json({ error: "Invalid origin" }, { status: 403 })
  }

  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)
  if (!auth.user || !auth.sub) {
    return { error: "not_authenticated" as const }
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string | null

  if (intent === "cancel") {
    const requestId = (formData.get("requestId") as string)?.trim()
    if (!requestId) return { error: "missing_request_id" as const }

    try {
      await runEffect(
        Effect.gen(function* () {
          const principalRepo = yield* PrincipalRepo
          const principal = yield* principalRepo.findByExternalId(auth.sub!)
          if (!principal) return yield* Effect.fail("principal_not_found" as const)
          return yield* cancelOwnAccessRequest({ requestId, requesterId: principal.id })
        }),
      )
      return { success: true as const, message: "cancelled" as const }
    } catch (e) {
      const tag = (e as { _tag?: string } | null)?._tag
      if (tag === "AccessRequestNotOwnedError") return { error: "not_owned" as const }
      if (tag === "AccessRequestNotCancellableError") return { error: "not_cancellable" as const }
      console.error("[requests] cancel failed:", e)
      return { error: "cancel_failed" as const }
    }
  }

  return { error: "unknown_intent" as const }
}

const statusBadge = (status: string): "default" | "success" | "warning" | "error" => {
  if (status === "pending") return "warning"
  if (status === "approved") return "success"
  if (status === "rejected") return "error"
  return "default"
}

export default function MyRequestsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { requests } = loaderData
  const fetcher = useFetcher<typeof action>()
  const dashboardData = useRouteLoaderData("routes/dashboard") as { user?: string; isAdmin?: boolean } | undefined
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  const data = (fetcher.data ?? null) as { success?: boolean; message?: string; error?: string } | null

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <Stack gap="md">
        <CardSection
          title={
            <>
              {t("requests.title")}
              <HelpPopover termKey="glossary.myRequests" />
            </>
          }
        >
          <Stack gap="md">
            {data?.success && <Alert variant="success">{t("requests.cancelled")}</Alert>}
            {data?.error && (
              <Alert variant="error">
                {t(`requests.error.${data.error}`, { defaultValue: t("requests.cancelFailed") }) as string}
              </Alert>
            )}

            {requests.length === 0 ? (
              <EmptyState message={t("requests.empty")} />
            ) : (
              <ScrollArea.Root>
                <ScrollArea.Viewport>
                  <ScrollArea.Content>
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>{t("requests.cols.status")}</Table.HeaderCell>
                          <Table.HeaderCell>{t("requests.cols.application")}</Table.HeaderCell>
                          <Table.HeaderCell>{t("requests.cols.role")}</Table.HeaderCell>
                          <Table.HeaderCell>{t("requests.cols.entitlement")}</Table.HeaderCell>
                          <Table.HeaderCell>{t("requests.cols.justification")}</Table.HeaderCell>
                          <Table.HeaderCell>{t("requests.cols.created")}</Table.HeaderCell>
                          <Table.HeaderCell>{t("requests.cols.action")}</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {requests.map((r) => (
                          <Table.Row key={r.id}>
                            <Table.Cell>
                              <Badge variant={statusBadge(r.status)}>{r.status}</Badge>
                            </Table.Cell>
                            <Table.Cell>{r.applicationName || r.applicationId}</Table.Cell>
                            <Table.Cell>{r.roleName ?? "—"}</Table.Cell>
                            <Table.Cell>{r.entitlementName ?? "—"}</Table.Cell>
                            <Table.Cell>
                              {r.justification ? (
                                r.justification.length > 60 ? (
                                  r.justification.slice(0, 60) + "…"
                                ) : (
                                  r.justification
                                )
                              ) : (
                                <Text color="muted">—</Text>
                              )}
                            </Table.Cell>
                            <Table.Cell>{new Date(r.createdAt).toLocaleDateString()}</Table.Cell>
                            <Table.Cell>
                              {r.status === "pending" && (
                                <fetcher.Form method="post">
                                  <input type="hidden" name="intent" value="cancel" />
                                  <input type="hidden" name="requestId" value={r.id} />
                                  <Button type="submit" variant="secondary" disabled={fetcher.state !== "idle"}>
                                    {t("requests.cancel")}
                                  </Button>
                                </fetcher.Form>
                              )}
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </ScrollArea.Content>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar orientation="horizontal">
                  <ScrollArea.Thumb orientation="horizontal" />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            )}
          </Stack>
        </CardSection>
      </Stack>
    </PageShell>
  )
}
