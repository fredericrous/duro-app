import { useState } from "react"
import { Effect } from "effect"
import { useFetcher, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/requests"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { AccessRequestRepo, type AccessRequestEnriched } from "~/lib/governance/AccessRequestRepo.server"
import { AccessInvitationRepo, type AccessInvitationEnriched } from "~/lib/governance/AccessInvitationRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { cancelOwnAccessRequest } from "~/lib/workflows/access-request.server"
import { acceptInvitation, declineInvitation } from "~/lib/workflows/access-invitation.server"
import { Header } from "~/components/Header/Header"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Inline,
  PageShell,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@duro-app/ui"

export function meta() {
  return [{ title: "My requests - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)
  if (!auth.user || !auth.sub) {
    return { requests: [] as AccessRequestEnriched[], invitations: [] as AccessInvitationEnriched[] }
  }

  const { requests, invitations } = await runEffect(
    Effect.gen(function* () {
      const principalRepo = yield* PrincipalRepo
      const principal = yield* principalRepo.findByExternalId(auth.sub!)
      if (!principal) {
        return { requests: [] as AccessRequestEnriched[], invitations: [] as AccessInvitationEnriched[] }
      }
      const reqRepo = yield* AccessRequestRepo
      const invRepo = yield* AccessInvitationRepo
      // Transition any expired invitations before listing so the invitee never
      // sees (or can accept) a stale one, and the admin badge can settle.
      yield* invRepo.markExpired()
      const requests = yield* reqRepo.listForRequesterEnriched(principal.id)
      const invitations = yield* invRepo.listPendingForPrincipalEnriched(principal.id)
      return { requests, invitations }
    }),
  )

  return { requests, invitations }
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

    // Tagged-error handling has to happen INSIDE the Effect, before runPromise
    // turns the failure into a FiberFailure rejection. The previous code
    // caught the rejection and read `(e as {_tag}).tag` on what is actually
    // a FiberFailure wrapper — that match never fired in production, so every
    // cancel error fell through to the generic "cancel_failed" outcome.
    const result = await runEffect(
      Effect.gen(function* () {
        const principalRepo = yield* PrincipalRepo
        const principal = yield* principalRepo.findByExternalId(auth.sub!)
        if (!principal) return { _kind: "principal_not_found" as const }
        yield* cancelOwnAccessRequest({ requestId, requesterId: principal.id })
        return { _kind: "ok" as const }
      }).pipe(
        Effect.catchTag("AccessRequestNotOwnedError", () => Effect.succeed({ _kind: "not_owned" as const })),
        Effect.catchTag("AccessRequestNotCancellableError", () =>
          Effect.succeed({ _kind: "not_cancellable" as const }),
        ),
        Effect.catchAll((e) => {
          console.error("[requests] cancel failed:", e)
          return Effect.succeed({ _kind: "cancel_failed" as const })
        }),
      ),
    )

    if (result._kind === "ok") return { success: true as const, message: "cancelled" as const }
    return { error: result._kind }
  }

  if (intent === "acceptInvitation" || intent === "declineInvitation") {
    const invitationId = (formData.get("invitationId") as string)?.trim()
    if (!invitationId) return { error: "missing_invitation_id" as const }

    const result = await runEffect(
      Effect.gen(function* () {
        const principalRepo = yield* PrincipalRepo
        const principal = yield* principalRepo.findByExternalId(auth.sub!)
        if (!principal) return { _kind: "principal_not_found" as const }
        if (intent === "acceptInvitation") {
          yield* acceptInvitation({ invitationId, principalId: principal.id })
        } else {
          yield* declineInvitation({ invitationId, principalId: principal.id })
        }
        return { _kind: "ok" as const, intent }
      }).pipe(
        // Surface the invitation error code so the UI can show a specific,
        // translated message (expired / already resolved / not yours).
        Effect.catchTag("AccessInvitationError", (e) => Effect.succeed({ _kind: e.code })),
        Effect.catchAll((e) => {
          console.error("[requests] invitation action failed:", e)
          return Effect.succeed({ _kind: "invitation_failed" as const })
        }),
      ),
    )

    if (result._kind === "ok") {
      return {
        success: true as const,
        message:
          result.intent === "acceptInvitation" ? ("invitation_accepted" as const) : ("invitation_declined" as const),
      }
    }
    return { error: result._kind }
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
  const { requests, invitations } = loaderData
  const fetcher = useFetcher<typeof action>()
  // The consequential row actions (cancel a request, decline an invitation)
  // open a confirm dialog keyed by the row id instead of firing on one click.
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [declineId, setDeclineId] = useState<string | null>(null)
  const dashboardData = useRouteLoaderData("routes/dashboard") as { user?: string; isAdmin?: boolean } | undefined
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  const data = (fetcher.data ?? null) as { success?: boolean; message?: string; error?: string } | null
  const busy = fetcher.state !== "idle"

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <Stack gap="md">
        {(data?.success || data?.error) && (
          <>
            {data?.success && (
              <Alert variant="success">
                {t(`requests.success.${data.message}`, { defaultValue: t("requests.cancelled") }) as string}
              </Alert>
            )}
            {data?.error && (
              <Alert variant="error">
                {t(`requests.error.${data.error}`, { defaultValue: t("requests.cancelFailed") }) as string}
              </Alert>
            )}
          </>
        )}

        {invitations.length > 0 && (
          <CardSection
            title={
              <>
                {t("requests.invitations.title")}
                <HelpPopover termKey="glossary.invitations" />
              </>
            }
          >
            <ScrollArea.Root>
              <ScrollArea.Viewport>
                <ScrollArea.Content>
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell>{t("requests.invitations.cols.application")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("requests.invitations.cols.access")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("requests.invitations.cols.invitedBy")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("requests.invitations.cols.message")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("requests.invitations.cols.action")}</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {invitations.map((inv) => (
                        <Table.Row key={inv.id}>
                          <Table.Cell>{inv.applicationName || inv.applicationId}</Table.Cell>
                          <Table.Cell>{inv.roleName ?? inv.entitlementName ?? <Text color="muted">—</Text>}</Table.Cell>
                          <Table.Cell>{inv.invitedByName ?? <Text color="muted">—</Text>}</Table.Cell>
                          <Table.Cell>
                            {inv.message ? (
                              inv.message.length > 60 ? (
                                inv.message.slice(0, 60) + "…"
                              ) : (
                                inv.message
                              )
                            ) : (
                              <Text color="muted">—</Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <Inline gap="sm">
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="acceptInvitation" />
                                <input type="hidden" name="invitationId" value={inv.id} />
                                <Button type="submit" variant="primary" disabled={busy}>
                                  {t("requests.invitations.accept")}
                                </Button>
                              </fetcher.Form>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setDeclineId(inv.id)}
                              >
                                {t("requests.invitations.decline")}
                              </Button>
                            </Inline>
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
          </CardSection>
        )}

        <CardSection
          title={
            <>
              {t("requests.title")}
              <HelpPopover termKey="glossary.myRequests" />
            </>
          }
        >
          <Stack gap="md">
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
                                <Button
                                  type="button"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => setCancelId(r.id)}
                                >
                                  {t("requests.cancel")}
                                </Button>
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

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => !open && setCancelId(null)}
        title={t("requests.cancelConfirmTitle")}
        confirmSlot={() => (
          <fetcher.Form method="post" onSubmit={() => setCancelId(null)}>
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="requestId" value={cancelId ?? ""} />
            <Button type="submit" variant="secondary">
              {t("requests.cancel")}
            </Button>
          </fetcher.Form>
        )}
      >
        {t("requests.cancelConfirmBody")}
      </ConfirmDialog>

      <ConfirmDialog
        open={declineId !== null}
        onOpenChange={(open) => !open && setDeclineId(null)}
        title={t("requests.invitations.declineConfirmTitle")}
        confirmSlot={() => (
          <fetcher.Form method="post" onSubmit={() => setDeclineId(null)}>
            <input type="hidden" name="intent" value="declineInvitation" />
            <input type="hidden" name="invitationId" value={declineId ?? ""} />
            <Button type="submit" variant="secondary">
              {t("requests.invitations.decline")}
            </Button>
          </fetcher.Form>
        )}
      >
        {t("requests.invitations.declineConfirmBody")}
      </ConfirmDialog>
    </PageShell>
  )
}
