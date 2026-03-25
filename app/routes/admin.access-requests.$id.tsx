import { useState } from "react"
import { useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/admin.access-requests.$id"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { Badge, Button, ButtonGroup, Field, Heading, Panel, Stack, Text, Textarea } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"

export async function loader({ params }: Route.LoaderArgs) {
  const requestId = params.id

  const [accessRequest, approvals] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        return yield* repo.findById(requestId)
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        return yield* repo.getApprovals(requestId)
      }),
    ),
  ])

  if (!accessRequest) {
    throw new Response("Access request not found", { status: 404 })
  }

  const requester = await runEffect(
    Effect.gen(function* () {
      const repo = yield* PrincipalRepo
      return yield* repo.findById(accessRequest.requesterId)
    }),
  )

  return { accessRequest, approvals, requester }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string
  const requestId = params.id
  const auth = await getAuth(request)
  const actorId = auth.user ?? "system"

  if (intent === "approve" || intent === "reject") {
    const comment = (formData.get("comment") as string) || undefined
    const decision = intent === "approve" ? "approved" : "rejected"

    await runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessRequestRepo
        yield* repo.recordDecision(requestId, actorId, decision, comment)
        yield* repo.updateStatus(requestId, decision)
      }),
    )
    return { success: true, decision }
  }

  return { error: "Unknown intent" }
}

export default function AdminAccessRequestDetailPage({ loaderData }: Route.ComponentProps) {
  const { accessRequest, approvals, requester } = loaderData
  const fetcher = useFetcher()
  const [comment, setComment] = useState("")

  const isSubmitting = fetcher.state !== "idle"
  const isPending = accessRequest.status === "pending"

  const statusVariant =
    accessRequest.status === "pending"
      ? "warning"
      : accessRequest.status === "approved"
        ? "success"
        : accessRequest.status === "rejected"
          ? "error"
          : "default"

  return (
    <Stack gap="md">
      <html.div>
        <Heading level={2}>Access Request</Heading>
        <Text color="muted">
          <Badge variant={statusVariant}>{accessRequest.status}</Badge> &middot; Created{" "}
          {new Date(accessRequest.createdAt).toLocaleString()}
        </Text>
      </html.div>

      <Panel.Root bordered>
        <Panel.Body>
          <Stack gap="sm">
            <html.div style={styles.field}>
              <Text color="muted">Requester</Text>
              <Text>{requester?.displayName ?? accessRequest.requesterId}</Text>
            </html.div>
            <html.div style={styles.field}>
              <Text color="muted">Application</Text>
              <Text>{accessRequest.applicationId}</Text>
            </html.div>
            {accessRequest.roleId && (
              <html.div style={styles.field}>
                <Text color="muted">Role</Text>
                <Text>{accessRequest.roleId}</Text>
              </html.div>
            )}
            {accessRequest.entitlementId && (
              <html.div style={styles.field}>
                <Text color="muted">Entitlement</Text>
                <Text>{accessRequest.entitlementId}</Text>
              </html.div>
            )}
            {accessRequest.resourceId && (
              <html.div style={styles.field}>
                <Text color="muted">Resource</Text>
                <Text>{accessRequest.resourceId}</Text>
              </html.div>
            )}
            {accessRequest.justification && (
              <html.div style={styles.field}>
                <Text color="muted">Justification</Text>
                <Text>{accessRequest.justification}</Text>
              </html.div>
            )}
            {accessRequest.requestedDurationHours != null && (
              <html.div style={styles.field}>
                <Text color="muted">Requested Duration</Text>
                <Text>{accessRequest.requestedDurationHours} hours</Text>
              </html.div>
            )}
          </Stack>
        </Panel.Body>
      </Panel.Root>

      {approvals.length > 0 && (
        <CardSection title={`Approvals (${approvals.length})`}>
          <Stack gap="sm">
            {approvals.map((approval) => (
              <html.div key={approval.id} style={styles.approvalRow}>
                <Text>
                  {approval.approverId} &middot;{" "}
                  {approval.decision ? (
                    <Badge variant={approval.decision === "approved" ? "success" : "error"}>{approval.decision}</Badge>
                  ) : (
                    <Badge variant="warning">pending</Badge>
                  )}
                </Text>
                {approval.comment && <Text color="muted">{approval.comment}</Text>}
                {approval.decidedAt && <Text color="muted">{new Date(approval.decidedAt).toLocaleString()}</Text>}
              </html.div>
            ))}
          </Stack>
        </CardSection>
      )}

      {isPending && (
        <Panel.Root bordered>
          <Panel.Body>
            <Stack gap="md">
              <Heading level={4}>Decision</Heading>
              <Field.Root>
                <Field.Label>Comment</Field.Label>
                <Textarea
                  name="comment"
                  placeholder="Optional comment..."
                  value={comment}
                  onChange={(e) => setComment((e.target as HTMLTextAreaElement).value)}
                />
              </Field.Root>
              <ButtonGroup>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="approve" />
                  <input type="hidden" name="comment" value={comment} />
                  <Button type="submit" variant="primary" disabled={isSubmitting}>
                    {isSubmitting ? "Processing..." : "Approve"}
                  </Button>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="reject" />
                  <input type="hidden" name="comment" value={comment} />
                  <Button type="submit" variant="danger" disabled={isSubmitting}>
                    {isSubmitting ? "Processing..." : "Reject"}
                  </Button>
                </fetcher.Form>
              </ButtonGroup>
            </Stack>
          </Panel.Body>
        </Panel.Root>
      )}
    </Stack>
  )
}

const styles = css.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  approvalRow: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "var(--color-border)",
  },
})
