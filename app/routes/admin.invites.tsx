import { startTransition, useEffect, useRef, useState } from "react"
import { html } from "react-strict-dom"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.invites"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { config } from "~/lib/config.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
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
  Dialog,
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
import { QrCode } from "~/components/QrCode/QrCode"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"
import { useDisplayFormat } from "~/hooks/useDisplayFormat"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const [groups, pendingInvites, failedInvites, checklist] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const users = yield* UserManager
        return yield* users.getGroups
      }).pipe(Effect.orDie),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findPending()
      }).pipe(Effect.orDie),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findFailed()
      }).pipe(Effect.orDie),
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
  await requireAdminAction(request)

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

  if (invite.status._tag === "Failed") return <Badge variant="error">{t("admin.invites.badge.failed")}</Badge>
  if (invite.status._tag === "Pending" && !invite.status.emailSent) {
    return invite.status.certIssued ? (
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
    items.push({ key: "teammate", href: "/admin/invites", label: t("admin.checklist.inviteTeammate") })
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

/** Big enough to scan from a phone held at arm's length. */
const QR_SIZE = 224

export default function AdminInvitesPage({ loaderData }: Route.ComponentProps) {
  "use no memo"
  const { t } = useTranslation()
  const { groups, pendingInvites, failedInvites, checklist } = loaderData
  const fetcher = useFetcher<typeof action>()
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = fetcher.state !== "idle"
  const [emails, setEmails] = useState<string[]>([])
  // Text typed into the tag input but not yet turned into a tag. It counts as a
  // recipient for both the button states and the submitted form.
  const [pendingEmail, setPendingEmail] = useState("")
  // The group checkboxes are mirrored into state purely so both send buttons
  // can stay disabled until a group is picked — the form still submits the
  // checkboxes' own DOM values.
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  // The QR dialog's visibility is derived, not stored: it is open whenever the
  // last result carries a link the admin hasn't dismissed yet. Tracking the
  // dismissed URL (rather than a boolean set from an effect) means a fresh
  // invite always reopens it, and re-renders never resurrect a closed one.
  const [dismissedInviteUrl, setDismissedInviteUrl] = useState<string | null>(null)
  const revalidator = useRevalidator()
  const revalidatorRef = useRef(revalidator)

  useEffect(() => {
    revalidatorRef.current = revalidator
  })

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      formRef.current?.reset()
      startTransition(() => {
        setEmails([])
        setPendingEmail("")
        setSelectedGroups([])
      })
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

  // Only text that looks like an address counts; a stray keystroke shouldn't
  // enable the buttons or get submitted as a recipient.
  const trimmedPending = pendingEmail.trim().toLowerCase()
  const pendingIsEmail = trimmedPending.includes("@")

  // Both buttons post the same form; only `delivery` differs. Building the
  // FormData here (rather than two nested forms or a submit-button `name`)
  // keeps a single source of truth for the fields.
  const submitInvite = (delivery: "email" | "link") => {
    const form = formRef.current
    if (!form) return
    const fd = new FormData(form)
    // The tag input's own text never lands in the form — add it here so an
    // address that was typed but not committed still gets invited.
    if (pendingIsEmail && !emails.includes(trimmedPending)) fd.append("emails", trimmedPending)
    fd.set("delivery", delivery)
    fetcher.submit(fd, { method: "post" })
  }

  const actionData = fetcher.data
  const hasRevocationWarning = actionData && "warning" in actionData && "emails" in actionData
  const successInvite = actionData && "success" in actionData ? actionData.invite : undefined
  const qrInvite = successInvite && successInvite.url !== dismissedInviteUrl ? successInvite : undefined
  // Neither button does anything useful without a recipient and a group, and a
  // QR code is scanned by one person, so it needs exactly one recipient.
  const recipientCount = emails.length + (pendingIsEmail && !emails.includes(trimmedPending) ? 1 : 0)
  const incomplete = recipientCount === 0 || selectedGroups.length === 0
  const sendDisabled = isSubmitting || incomplete
  const qrDisabled = sendDisabled || recipientCount !== 1

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
                <html.input key={e} type="hidden" name="emails" value={e} />
              ))}
              <html.input type="hidden" name="confirmed" value="true" />
              <html.input type="hidden" name="revocationId" value={actionData.revocationId} />
              <html.input type="hidden" name="delivery" value={actionData.delivery} />
              {(actionData.groups as string[]).map((g) => (
                <html.input key={g} type="hidden" name="groups" value={g} />
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
              {/* TagGroup.Input takes only a placeholder, so the text someone
                  has typed but not yet turned into a tag is invisible to this
                  component. Watching input events on the wrapper recovers it —
                  without that, typing an address and clicking Send does
                  nothing, which reads as a broken button. */}
              {/* eslint-disable-next-line duro/no-raw-html-element -- html.div
                  exposes no onInput/onBlur, and those events are the only way
                  to observe TagGroup's uncommitted input text. */}
              <div
                onInput={(e) => setPendingEmail((e.target as HTMLInputElement).value ?? "")}
                onBlur={(e) => setPendingEmail((e.target as HTMLInputElement).value ?? "")}
              >
                <TagGroup.Root
                  name="emails"
                  value={emails}
                  onValueChange={(next) => {
                    setEmails(next)
                    // Committing a tag empties the input.
                    setPendingEmail("")
                  }}
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
              </div>
              <Field.Description>{t("admin.invites.emailHint")}</Field.Description>
            </Field.Root>

            <Field.Root required>
              <Field.Label>{t("admin.invites.groupsLabel")}</Field.Label>
              <Cluster gap="ms">
                {groups.map((g) => {
                  const value = `${g.id}|${g.displayName}`
                  return (
                    <Checkbox
                      key={g.id}
                      name="groups"
                      value={value}
                      checked={selectedGroups.includes(value)}
                      onChange={(e) =>
                        setSelectedGroups((prev) =>
                          e.target.checked ? [...prev, value] : prev.filter((v) => v !== value),
                        )
                      }
                    >
                      {g.displayName}
                    </Checkbox>
                  )
                })}
              </Cluster>
            </Field.Root>

            <Field.Root>
              <Field.Label>{t("admin.invites.languageLabel")}</Field.Label>
              <LanguageSelect />
            </Field.Root>

            <Stack gap="xs">
              <Inline gap="sm">
                <Button type="button" variant="primary" disabled={sendDisabled} onClick={() => submitInvite("email")}>
                  {isSubmitting ? t("admin.invites.submitting") : t("admin.invites.submit")}
                </Button>
                <Button type="button" variant="secondary" disabled={qrDisabled} onClick={() => submitInvite("link")}>
                  {t("admin.invites.qr.button")}
                </Button>
              </Inline>
              <Text as="p" variant="bodySm" color="muted">
                {incomplete
                  ? t("admin.invites.needEmailAndGroup")
                  : recipientCount > 1
                    ? t("admin.invites.qr.singleEmailHint")
                    : t("admin.invites.qr.hint")}
              </Text>
            </Stack>
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
                <Table.HeaderCell width="max-content">{t("admin.invites.cols.actions")}</Table.HeaderCell>
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
                <Table.HeaderCell width="max-content">{t("admin.invites.cols.actions")}</Table.HeaderCell>
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

      <InviteQrDialog invite={qrInvite} onClose={() => setDismissedInviteUrl(qrInvite?.url ?? null)} />
    </Stack>
  )
}

/**
 * Shown once a "Generate a QR code" invite comes back. The token is a bearer
 * secret that only ever arrives on the action's POST response, so this dialog
 * is the single place it is ever displayed — closing it is final, which is why
 * the link is also copyable.
 */
function InviteQrDialog({
  invite,
  onClose,
}: {
  invite?: { url: string; email: string; expiresAt: string }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { formatDateTime } = useDisplayFormat()
  const { copied, copyFailed, copy } = useCopyFeedback()

  return (
    <Dialog.Root
      open={invite != null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <Dialog.Portal size="sm">
        <Dialog.Header>
          <Dialog.Title>{t("admin.invites.qr.title")}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {invite && (
            <Stack gap="md" align="center">
              <Alert variant="success">{t("admin.invites.qr.success", { email: invite.email })}</Alert>
              <QrCode value={invite.url} label={t("admin.invites.qr.alt")} size={QR_SIZE} />
              <Text as="p" variant="bodySm" color="muted">
                {t("admin.invites.qr.emailNote", { email: invite.email })}
              </Text>
              <Button variant="secondary" size="small" onClick={() => copy(invite.url)}>
                {copyFailed
                  ? t("admin.invites.qr.copyFailed")
                  : copied
                    ? t("admin.invites.qr.copied")
                    : t("admin.invites.qr.copyLink")}
              </Button>
              <Text as="p" variant="bodySm" color="muted">
                {t("admin.invites.qr.expiry", { time: formatDateTime(invite.expiresAt) })}
              </Text>
            </Stack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        </Dialog.Footer>
      </Dialog.Portal>
    </Dialog.Root>
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
            <html.input type="hidden" name="intent" value="resend" />
            <html.input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={isResending || isRevoking}>
              {isResending ? t("admin.invites.action.resending") : t("admin.invites.action.resend")}
            </Button>
          </resendFetcher.Form>
          <revokeFetcher.Form method="post">
            <html.input type="hidden" name="intent" value="revoke" />
            <html.input type="hidden" name="inviteId" value={invite.id} />
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
            <html.input type="hidden" name="intent" value="retry" />
            <html.input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="secondary" size="small" disabled={isRetrying || isRevoking}>
              {isRetrying ? t("admin.invites.action.retrying") : t("admin.invites.action.retry")}
            </Button>
          </retryFetcher.Form>
          <revokeFetcher.Form method="post">
            <html.input type="hidden" name="intent" value="revoke" />
            <html.input type="hidden" name="inviteId" value={invite.id} />
            <Button type="submit" variant="danger" size="small" disabled={isRevoking || isRetrying}>
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </Button>
          </revokeFetcher.Form>
        </Inline>
      </Table.Cell>
    </Table.Row>
  )
}
