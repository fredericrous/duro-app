import type { Route } from "./+types/admin.recovery"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { requireAuth } from "~/lib/auth.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { RecoveryRepo, type RecoveryRequest } from "~/lib/services/RecoveryRepo.server"
import { approveRecovery, denyRecovery } from "~/lib/workflows/recovery.server"
import { CardSection } from "~/components/CardSection/CardSection"
import { Alert, Button, Inline, Stack, Table, Text } from "@duro-app/ui"

export async function loader() {
  const pending = await runEffect(
    Effect.gen(function* () {
      const repo = yield* RecoveryRepo
      return yield* repo.listByStatus("pending")
    }),
  )
  return { pending }
}

export async function action({ request }: Route.ActionArgs) {
  // This action mints a certificate on approval, so gate it explicitly on the
  // admin group rather than relying solely on the gateway/parent-loader gate.
  const auth = await requireAuth(request)
  if (!auth.groups.includes(config.adminGroupName)) {
    throw new Response("Forbidden", { status: 403 })
  }
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const fd = await request.formData()
  const intent = fd.get("intent") as string | null
  const requestId = fd.get("requestId") as string | null
  if (!requestId) return { error: "Missing request id" }

  try {
    if (intent === "approve") {
      const r = await runEffect(approveRecovery(requestId, auth.user ?? auth.sub ?? "admin"))
      return { approved: true as const, email: r.email }
    }
    if (intent === "deny") {
      await runEffect(denyRecovery(requestId, auth.user ?? auth.sub ?? "admin"))
      return { denied: true as const }
    }
    return { error: "Unknown action" }
  } catch (e: any) {
    const cause = e?.cause ?? e
    return { error: typeof cause?.message === "string" ? cause.message : "Action failed" }
  }
}

function RequestRow({ req }: { req: RecoveryRequest }) {
  const { t } = useTranslation()
  const fetcher = useFetcher<{ approved?: true; denied?: true; error?: string }>()
  const resolved = fetcher.data && (fetcher.data.approved || fetcher.data.denied)
  if (resolved) return null
  const submitting = fetcher.state !== "idle"

  return (
    <Table.Row>
      <Table.Cell>{req.email}</Table.Cell>
      <Table.Cell>{new Date(req.createdAt).toLocaleString()}</Table.Cell>
      <Table.Cell>
        <code style={{ fontFamily: "monospace" }}>{req.requestIp ?? "—"}</code>
      </Table.Cell>
      <Table.Cell>{req.note ?? "—"}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="approve" />
            <input type="hidden" name="requestId" value={req.id} />
            <Button type="submit" variant="primary" size="small" disabled={submitting}>
              {t("admin.recovery.approve")}
            </Button>
          </fetcher.Form>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="deny" />
            <input type="hidden" name="requestId" value={req.id} />
            <Button type="submit" variant="danger" size="small" disabled={submitting}>
              {t("admin.recovery.deny")}
            </Button>
          </fetcher.Form>
        </Inline>
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
