import { useEffect, useRef } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.invites"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { config } from "~/lib/config.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { handleAdminInvitesMutation, parseAdminInvitesMutation } from "~/lib/mutations/admin-invites"
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Cluster,
  Field,
  Fieldset,
  Inline,
  Input,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"

export async function loader() {
  const [groups, pendingInvites, failedInvites] = await Promise.all([
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
  ])

  return { groups, pendingInvites, failedInvites }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminInvitesMutation(formData as any)
  if ("error" in parsed) return parsed

  return await runEffect(handleAdminInvitesMutation(parsed))
}

function StepBadges({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  if (invite.failedAt) return <Badge variant="error">{t("admin.invites.badge.failed")}</Badge>
  if (invite.emailSent) return <Badge variant="success">{t("admin.invites.badge.sent")}</Badge>
  if (invite.certIssued) return <Badge variant="success">{t("admin.invites.badge.certIssued")}</Badge>
  return <Badge variant="warning">{t("admin.invites.badge.processing")}</Badge>
}

export default function AdminInvitesPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { groups, pendingInvites, failedInvites } = loaderData
  const fetcher = useFetcher<typeof action>()
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = fetcher.state !== "idle"
  const revalidator = useRevalidator()
  const revalidatorRef = useRef(revalidator)

  useEffect(() => {
    revalidatorRef.current = revalidator
  })

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      formRef.current?.reset()
    }
  }, [fetcher.data])

  // Auto-refresh while invites are still processing
  useEffect(() => {
    const hasIncomplete = pendingInvites.some((i) => !i.emailSent)
    if (!hasIncomplete) return

    const interval = setInterval(() => {
      if (revalidatorRef.current.state === "idle") {
        revalidatorRef.current.revalidate()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [pendingInvites])

  const actionData = fetcher.data
  const hasRevocationWarning = actionData && "warning" in actionData && "groups" in actionData

  return (
    <Stack gap="md">
      <CardSection title={t("admin.invites.sendTitle")}>
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}
        {hasRevocationWarning && (
          <Alert variant="warning">
            <Text as="p">{actionData.warning}</Text>
            <fetcher.Form method="post" style={{ marginTop: "0.5rem" }}>
              <input type="hidden" name="email" value={actionData.email} />
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
            <Field.Root>
              <Field.Label>{t("admin.invites.emailLabel")}</Field.Label>
              <Input name="email" type="email" required placeholder={t("admin.invites.emailPlaceholder")} />
            </Field.Root>

            <Field.Root>
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
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
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
              </ScrollArea.Content>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="horizontal">
              <ScrollArea.Thumb orientation="horizontal" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </CardSection>
      )}

      <CardSection title={`${t("admin.invites.activeTitle")} (${pendingInvites.length})`}>
        {pendingInvites.length === 0 ? (
          <Text variant="bodySm" color="muted" as="p">
            {t("admin.invites.noActive")}
          </Text>
        ) : (
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("admin.invites.cols.email")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.invites.cols.groups")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("admin.invites.cols.status")}</Table.HeaderCell>
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
              </ScrollArea.Content>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="horizontal">
              <ScrollArea.Thumb orientation="horizontal" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
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
        <StepBadges invite={invite} />
      </Table.Cell>
      <Table.Cell>{invite.invitedBy}</Table.Cell>
      <Table.Cell>{new Date(invite.expiresAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>
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
      <Table.Cell>
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
