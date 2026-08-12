import { useState } from "react"
import { html } from "react-strict-dom"
import type { Route } from "./+types/admin.recovery"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { RecoveryRepo, type RecoveryRequest } from "~/lib/services/RecoveryRepo.server"
import { approveRecovery, denyRecovery } from "~/lib/workflows/recovery.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { Button, Checkbox, ConfirmDialog, Inline, Stack, Table, Text } from "@duro-app/ui"
import { useFetcherToast } from "~/lib/useFetcherToast"

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const pending = await runEffect(
    Effect.gen(function* () {
      const repo = yield* RecoveryRepo
      return yield* repo.listByStatus("pending")
    }).pipe(Effect.orDie),
  )
  return { pending }
}

export async function action({ request }: Route.ActionArgs) {
  // This action mints a certificate on approval, so self-gate it explicitly
  // (admin decision + origin check) rather than relying solely on the
  // gateway/parent-loader gate.
  const auth = await requireAdminAction(request)

  const fd = await request.formData()
  const intent = fd.get("intent") as string | null
  const requestId = fd.get("requestId") as string | null
  if (!requestId) return { error: "Missing request id" }

  // Typed errors map to the toast INSIDE the Effect — no FiberFailure
  // cause-sniffing on the rejection (the pattern that silently broke twice).
  const toToastError = (e: unknown) =>
    Effect.succeed({
      error: e instanceof Error && typeof e.message === "string" && e.message !== "" ? e.message : "Action failed",
    })

  if (intent === "approve") {
    const revokeOthers = fd.get("revokeOthers") === "on"
    return await runEffect(
      approveRecovery(requestId, auth.user ?? auth.sub ?? "admin", revokeOthers).pipe(
        Effect.map((r) => ({ approved: true as const, email: r.email, revokedCount: r.revokedCount })),
        Effect.catchAll(toToastError),
      ),
    )
  }
  if (intent === "deny") {
    return await runEffect(
      denyRecovery(requestId, auth.user ?? auth.sub ?? "admin").pipe(
        Effect.as({ denied: true as const }),
        Effect.catchAll(toToastError),
      ),
    )
  }
  return { error: "Unknown action" }
}

function RequestRow({ req }: { req: RecoveryRequest }) {
  const { t } = useTranslation()
  const fetcher = useFetcher<{ approved?: true; denied?: true; revokedCount?: number; error?: string }>()
  useFetcherToast(fetcher, {
    render: (data) => {
      const d = data as { approved?: true; denied?: true; revokedCount?: number; error?: string }
      if (d.error) return { variant: "error", message: d.error }
      if (d.approved)
        return { variant: "success", message: t("admin.recovery.approved", { count: d.revokedCount ?? 0 }) }
      if (d.denied) return { variant: "success", message: t("admin.recovery.denied") }
      return null
    },
  })
  const [approveOpen, setApproveOpen] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const resolved = fetcher.data && (fetcher.data.approved || fetcher.data.denied)
  if (resolved) return null
  const submitting = fetcher.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{req.email}</Table.Cell>
      <Table.Cell>{new Date(req.createdAt).toLocaleString()}</Table.Cell>
      <Table.Cell>
        <Text as="span" variant="code">
          {req.requestIp ?? "—"}
        </Text>
      </Table.Cell>
      <Table.Cell>{req.note ?? "—"}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <Button
            type="button"
            variant="primary"
            size="small"
            disabled={submitting}
            onClick={() => setApproveOpen(true)}
          >
            {t("admin.recovery.approve")}
          </Button>
          <Button type="button" variant="danger" size="small" disabled={submitting} onClick={() => setDenyOpen(true)}>
            {t("admin.recovery.deny")}
          </Button>
        </Inline>

        <ConfirmDialog
          open={approveOpen}
          onOpenChange={setApproveOpen}
          title={t("admin.recovery.confirmApproveTitle")}
          confirmSlot={() => (
            <fetcher.Form method="post" onSubmit={() => setApproveOpen(false)}>
              <Stack gap="sm">
                {/* Opt-in (unchecked by default): revoking other devices is destructive. */}
                <Checkbox name="revokeOthers" value="on">
                  {t("admin.recovery.revokeOthers")}
                </Checkbox>
                <html.input type="hidden" name="intent" value="approve" />
                <html.input type="hidden" name="requestId" value={req.id} />
                <Button type="submit" variant="primary">
                  {t("admin.recovery.approve")}
                </Button>
              </Stack>
            </fetcher.Form>
          )}
        >
          {t("admin.recovery.confirmApproveBody", { email: req.email })}
        </ConfirmDialog>

        <ConfirmDialog
          open={denyOpen}
          onOpenChange={setDenyOpen}
          title={t("admin.recovery.confirmDenyTitle")}
          confirmSlot={() => (
            <fetcher.Form method="post" onSubmit={() => setDenyOpen(false)}>
              <html.input type="hidden" name="intent" value="deny" />
              <html.input type="hidden" name="requestId" value={req.id} />
              <Button type="submit" variant="danger">
                {t("admin.recovery.deny")}
              </Button>
            </fetcher.Form>
          )}
        >
          {t("admin.recovery.confirmDenyBody")}
        </ConfirmDialog>
      </Table.Cell>
    </Table.Row>
  )
}

export default function AdminRecoveryPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { pending } = loaderData

  return (
    <CardSection title={t("admin.recovery.heading")}>
      <Stack gap="md">
        <Text as="p" color="muted">
          {t("admin.recovery.description")}
        </Text>
        {pending.length === 0 ? (
          <Text as="p" color="muted" variant="bodySm">
            {t("admin.recovery.empty")}
          </Text>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("admin.recovery.col.email")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.recovery.col.requested")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.recovery.col.ip")}</Table.HeaderCell>
                <Table.HeaderCell>{t("admin.recovery.col.note")}</Table.HeaderCell>
                <Table.HeaderCell>{t("common.actions")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {pending.map((req) => (
                <RequestRow key={req.id} req={req} />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Stack>
    </CardSection>
  )
}
