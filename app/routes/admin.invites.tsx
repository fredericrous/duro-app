import { startTransition, useEffect, useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.invites"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { handleAdminInvitesMutation, parseAdminInvitesMutation } from "~/lib/mutations/admin-invites"
import { classifyOpenUA } from "~/lib/invite-open-ua"
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Cluster,
  Field,
  Fieldset,
  Inline,
  LinkButton,
  Stack,
  Table,
  Tag,
  TagGroup,
  Text,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"

export async function loader() {
  const [groups, pendingInvites, failedInvites, checklist] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const users = yield* UserManager
        return yield* users.getGroups
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findPending()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findFailed()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const userMgr = yield* UserManager
        const appRepo = yield* ApplicationRepo
        const systems = yield* ConnectedSystemRepo

        // Each branch is best-effort: if any one fails, we hide that
        // checklist item rather than failing the whole admin index.
        const users = yield* userMgr.getUsers.pipe(Effect.catchAll(() => Effect.succeed([] as Array<{ id: string }>)))
        const apps = yield* appRepo.list().pipe(Effect.catchAll(() => Effect.succeed([] as Array<unknown>)))
        const connectedSystems = yield* systems
          .countByPluginSlug()
          .pipe(Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<{ pluginSlug: string; count: number }>)))

        const humanCount = users.filter((u) => !config.isSystemUser(u.id)).length
        const appCount = apps.length
        const connectedSystemCount = connectedSystems.reduce<number>((sum, s) => sum + s.count, 0)

        return {
          showAddApplication: appCount === 0,
          showInviteTeammate: humanCount <= 1,
          showConfigurePlugins: connectedSystemCount === 0,
        }
      }),
    ),
  ])

  return { groups, pendingInvites, failedInvites, checklist }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (!isOriginAllowed(origin)) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminInvitesMutation(formData as any)
  if ("error" in parsed) return parsed

  return await runEffect(handleAdminInvitesMutation(parsed))
}

function fmtDate(ts: string | null): string | null {
  return ts ? new Date(ts).toLocaleString() : null
}

/**
 * The invite engagement funnel: Sent → Opened → Clicked → Cert installed.
 *
 * The last two stages are progressively stronger signals — Opened is noisy
 * (mail proxies pre-fetch the pixel on delivery), Clicked is a human action,
 * and Cert installed is ground truth. Pre-send states (processing / failed)
 * keep their original single-badge treatment.
 */
function InviteFunnel({ invite }: { invite: Invite }) {
  const { t } = useTranslation()

  if (invite.failedAt) return <Badge variant="error">{t("admin.invites.badge.failed")}</Badge>
  if (!invite.emailSent) {
    return invite.certIssued ? (
      <Badge variant="success">{t("admin.invites.badge.certIssued")}</Badge>
    ) : (
      <Badge variant="warning">{t("admin.invites.badge.processing")}</Badge>
    )
  }

  // Bounced is a terminal SMTP failure — the mail never arrived. Surface it
  // loudly with the reason instead of the progress chips.
  if (invite.deliveryStatus === "bounced") {
    return (
      <Stack gap="xs">
        <Inline gap="xs" align="center">
          <Badge variant="success">{t("admin.invites.funnel.sent")}</Badge>
          <Badge variant="error">{t("admin.invites.funnel.bounced")}</Badge>
        </Inline>
        {invite.deliveryDetail && (
          <Text variant="bodySm" color="error">
            {t("admin.invites.funnel.bounceReason", { reason: invite.deliveryDetail })}
          </Text>
        )}
      </Stack>
    )
  }

  const openedProxy = invite.openCount > 0 && classifyOpenUA(invite.lastOpenUserAgent) === "proxy"
  const clickedProxy = invite.clickCount > 0 && classifyOpenUA(invite.lastClickUserAgent) === "proxy"

  const stages: Array<{ key: string; reached: boolean; at: string | null }> = [
    { key: "sent", reached: true, at: fmtDate(invite.createdAt) },
    { key: "delivered", reached: invite.deliveryStatus === "delivered", at: fmtDate(invite.deliveredAt) },
    { key: "opened", reached: invite.openCount > 0, at: fmtDate(invite.firstOpenedAt) },
    { key: "clicked", reached: invite.clickCount > 0, at: fmtDate(invite.firstClickedAt) },
    { key: "installed", reached: invite.certVerified, at: fmtDate(invite.certVerifiedAt) },
  ]

  const reachedWithTime = stages.filter((s) => s.reached && s.at)
  const latest = reachedWithTime[reachedWithTime.length - 1]

  return (
    <Stack gap="xs">
      <Inline gap="xs" align="center">
        {stages.map((s) => (
          <Badge key={s.key} variant={s.reached ? "success" : "default"}>
            {t(`admin.invites.funnel.${s.key}`)}
          </Badge>
        ))}
      </Inline>
      {latest && (
        <Text variant="bodySm" color="muted">
          {t("admin.invites.funnel.last", { stage: t(`admin.invites.funnel.${latest.key}`), date: latest.at })}
        </Text>
      )}
      {invite.deliveryStatus === "deferred" && (
        <Text variant="bodySm" color="muted">
          {t("admin.invites.funnel.deferred")}
        </Text>
      )}
      {(openedProxy || clickedProxy) && (
        <Text variant="bodySm" color="muted">
          {t("admin.invites.funnel.proxyHint")}
        </Text>
      )}
    </Stack>
  )
}

function GetStartedChecklist({
  checklist,
}: {
  checklist: { showAddApplication: boolean; showInviteTeammate: boolean; showConfigurePlugins: boolean }
}) {
  const { t } = useTranslation()
  const items: Array<{ key: string; href: string; label: string }> = []
  if (checklist.showAddApplication) {
    items.push({ key: "app", href: "/admin/applications", label: t("admin.checklist.addApplication") })
  }
  if (checklist.showInviteTeammate) {
    items.push({ key: "teammate", href: "/admin", label: t("admin.checklist.inviteTeammate") })
  }
  if (checklist.showConfigurePlugins) {
    items.push({ key: "plugins", href: "/admin/plugins", label: t("admin.checklist.configurePlugins") })
  }
  if (items.length === 0) return null

  return (
    <CardSection title={t("admin.checklist.title")}>
      <Stack gap="sm">
        <Text as="p" color="muted">
          {t("admin.checklist.subtitle")}
        </Text>
        <Inline gap="sm">
          {items.map((item) => (
            <LinkButton key={item.key} href={item.href} variant="secondary">
              {item.label}
            </LinkButton>
          ))}
        </Inline>
      </Stack>
    </CardSection>
  )
}

export default function AdminInvitesPage({ loaderData }: Route.ComponentProps) {
  "use no memo"
  const { t } = useTranslation()
  const { groups, pendingInvites, failedInvites, checklist } = loaderData
  const fetcher = useFetcher<typeof action>()
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = fetcher.state !== "idle"
  const [emails, setEmails] = useState<string[]>([])
  const revalidator = useRevalidator()
  const revalidatorRef = useRef(revalidator)

  useEffect(() => {
    revalidatorRef.current = revalidator
  })

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      formRef.current?.reset()
      startTransition(() => setEmails([]))
    }
  }, [fetcher.data])

  // Auto-refresh while there's something to watch:
  //  - invites still processing (cert/email pipeline) → fast 5s cadence
  //  - invites sent but funnel incomplete (cert not yet installed) → slow 30s
  //    cadence; opens/clicks/installs aren't time-critical, and we don't want a
  //    permanent 5s loop on the admin page. Stops once cert is verified.
  useEffect(() => {
    const hasProcessing = pendingInvites.some((i) => !i.emailSent)
    const hasIncompleteFunnel = pendingInvites.some((i) => i.emailSent && !i.certVerified)
    if (!hasProcessing && !hasIncompleteFunnel) return

    const delay = hasProcessing ? 5000 : 30000
    const interval = setInterval(() => {
      if (revalidatorRef.current.state === "idle") {
        revalidatorRef.current.revalidate()
      }
    }, delay)

    return () => clearInterval(interval)
  }, [pendingInvites])

  const actionData = fetcher.data
  const hasRevocationWarning = actionData && "warning" in actionData && "emails" in actionData

  return (
    <Stack gap="md">
      <GetStartedChecklist checklist={checklist} />
      <CardSection title={t("admin.invites.sendTitle")}>
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}
        {hasRevocationWarning && (
          <Alert variant="warning">
            <Text as="p">{actionData.warning}</Text>
            <fetcher.Form method="post" style={{ marginTop: "0.5rem" }}>
              {(actionData.emails as string[]).map((e) => (
                <input key={e} type="hidden" name="emails" value={e} />
              ))}
              <input type="hidden" name="confirmed" value="true" />
              <input type="hidden" name="revocationId" value={actionData.revocationId} />
              {(actionData.groups as string[]).map((g) => (
                <input key={g} type="hidden" name="groups" value={g} />
              ))}
              <Button type="submit" variant="primary">
                {t("admin.invites.proceedAnyway")}
              </Button>
            </fetcher.Form>
          </Alert>
        )}

        <fetcher.Form method="post" ref={formRef}>
          <Fieldset.Root disabled={isSubmitting} gap="md">
            <Field.Root required>
              <Field.Label>{t("admin.invites.emailLabel")}</Field.Label>
              <TagGroup.Root
                name="emails"
                value={emails}
                onValueChange={setEmails}
                onValidate={(v) => (v.includes("@") ? true : t("admin.invites.emailInvalid"))}
              >
                <TagGroup.List aria-label={t("admin.invites.emailLabel")}>
                  {emails.map((email) => (
                    <Tag key={email} value={email}>
                      {email}
                    </Tag>
                  ))}
                </TagGroup.List>
                <TagGroup.Input placeholder={t("admin.invites.emailPlaceholder")} />
              </TagGroup.Root>
              <Field.Description>{t("admin.invites.emailHint")}</Field.Description>
            </Field.Root>

            <Field.Root required>
              <Field.Label>{t("admin.invites.groupsLabel")}</Field.Label>
              <Cluster gap="ms">
                {groups.map((g) => (
                  <Checkbox key={g.id} name="groups" value={`${g.id}|${g.displayName}`}>
                    {g.displayName}
                  </Checkbox>
                ))}
              </Cluster>
            </Field.Root>

            <Field.Root>
              <Field.Label>{t("admin.invites.languageLabel")}</Field.Label>
              <LanguageSelect />
            </Field.Root>

            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? t("admin.invites.submitting") : t("admin.invites.submit")}
            </Button>
          </Fieldset.Root>
        </fetcher.Form>
      </CardSection>

      {failedInvites.length > 0 && (
        <CardSection title={`${t("admin.invites.failedTitle")} (${failedInvites.length})`}>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("admin.invites.cols.email")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.error")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.failedAt")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.actions")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {failedInvites.map((i) => (
                <FailedInviteRow key={i.id} invite={i} />
              ))}
            </Table.Body>
          </Table.Root>
        </CardSection>
      )}

      <CardSection title={`${t("admin.invites.activeTitle")} (${pendingInvites.length})`}>
        {pendingInvites.length === 0 ? (
          <Text variant="bodySm" color="muted" as="p">
            {t("admin.invites.noActive")}
          </Text>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("admin.invites.cols.email")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.groups")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.progress")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.invitedBy")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.expires")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.invites.cols.actions")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {pendingInvites.map((i) => (
                <PendingInviteRow key={i.id} invite={i} />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </CardSection>
    </Stack>
  )
}

function PendingInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const revokeFetcher = useFetcher()
  const resendFetcher = useFetcher()
  const isRevoking = revokeFetcher.state !== "idle"
  const isResending = resendFetcher.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{invite.email}</Table.Cell>
      <Table.Cell>{JSON.parse(invite.groupNames).join(", ")}</Table.Cell>
      <Table.Cell>
        <InviteFunnel invite={invite} />
      </Table.Cell>
      <Table.Cell>{invite.invitedBy}</Table.Cell>
      <Table.Cell>{new Date(invite.expiresAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell isActions>
        <Inline gap="sm">
          <resendFetcher.Form method="post">
            <input type="hidden" name="intent" value="resend" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={isResending || isRevoking}>
              {isResending ? t("admin.invites.action.resending") : t("admin.invites.action.resend")}
            </Button>
          </resendFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="danger" size="small" disabled={isRevoking || isResending}>
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </revokeFetcher.Form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}

function FailedInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const retryFetcher = useFetcher()
  const revokeFetcher = useFetcher()
  const isRetrying = retryFetcher.state !== "idle"
  const isRevoking = revokeFetcher.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{invite.email}</Table.Cell>
      <Table.Cell>
        <Text color="muted" variant="bodySm">
          {invite.lastError ?? "Unknown error"}
        </Text>
      </Table.Cell>
      <Table.Cell>{invite.failedAt ? new Date(invite.failedAt).toLocaleString() : "\u2014"}</Table.Cell>
      <Table.Cell isActions>
        <Inline gap="sm">
          <retryFetcher.Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={isRetrying || isRevoking}>
              {isRetrying ? t("admin.invites.action.retrying") : t("admin.invites.action.retry")}
            </Button>
          </retryFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="danger" size="small" disabled={isRevoking || isRetrying}>
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </revokeFetcher.Form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}
