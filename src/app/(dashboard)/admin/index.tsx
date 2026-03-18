import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { Invite } from "~/lib/services/InviteRepo.server"
import type { AdminInvitesResult } from "~/lib/mutations/admin-invites"
import { Alert, Button, Checkbox, Cluster, Field, Fieldset, Input, ScrollArea, Stack, Text } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { PendingInviteRow } from "~/components/admin/PendingInviteRow"
import { FailedInviteRow } from "~/components/admin/FailedInviteRow"
import { Table } from "@duro-app/ui"

interface Group {
  id: number
  displayName: string
}

interface AdminInvitesData {
  user: string
  isAdmin: boolean
  groups: Group[]
  pendingInvites: Invite[]
  failedInvites: Invite[]
}

async function submitInviteAction(formData: FormData): Promise<AdminInvitesResult> {
  const res = await fetch("/admin/invites", { method: "POST", body: formData })
  return res.json()
}

export default function AdminInvitesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)

  const { data: pageData, isLoading } = useQuery<AdminInvitesData>({
    queryKey: ["admin-invites"],
    queryFn: () => fetch("/admin/invites").then((r) => r.json()),
  })

  const mutation = useMutation({
    mutationFn: submitInviteAction,
    onSuccess: (data) => {
      if ("success" in data && data.success) {
        formRef.current?.reset()
      }
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] })
    },
  })

  // Auto-dismiss success message after 5s
  useEffect(() => {
    if (mutation.data && "success" in mutation.data) {
      const id = setTimeout(() => mutation.reset(), 5000)
      return () => clearTimeout(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.data])

  if (isLoading || !pageData) {
    return (
      <Text as="p" color="muted">
        Loading...
      </Text>
    )
  }

  const { groups, pendingInvites, failedInvites } = pageData
  const actionData = mutation.data
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
            <form
              onSubmit={(e) => {
                e.preventDefault()
                mutation.mutate(new FormData(e.currentTarget))
              }}
            >
              <input type="hidden" name="email" value={actionData.email} />
              <input type="hidden" name="confirmed" value="true" />
              <input type="hidden" name="revocationId" value={actionData.revocationId} />
              {actionData.groups.map((g) => (
                <input key={g} type="hidden" name="groups" value={g} />
              ))}
              <Button type="submit" variant="primary">
                {t("admin.invites.proceedAnyway")}
              </Button>
            </form>
          </Alert>
        )}

        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate(new FormData(e.currentTarget))
          }}
        >
          <Fieldset.Root disabled={mutation.isPending} gap="md">
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

            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? t("admin.invites.submitting") : t("admin.invites.submit")}
            </Button>
          </Fieldset.Root>
        </form>
      </CardSection>

      {failedInvites.length > 0 && (
        <CardSection title={`${t("admin.invites.failedTitle")} (${failedInvites.length})`}>
          <ScrollArea.Root>
            <ScrollArea.Viewport>
              <ScrollArea.Content>
                <Table.Root columns={4}>
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
                <Table.Root columns={6}>
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
