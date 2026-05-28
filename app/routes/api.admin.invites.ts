import { Effect } from "effect"
import type { Route } from "./+types/api.admin.invites"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { queueInvite } from "~/lib/workflows/invite.server"
import { runEffect } from "~/lib/runtime.server"

interface GroupRef {
  id: number
  name: string
}

interface Body {
  email?: unknown
  groups?: unknown
  locale?: unknown
}

function parseGroups(raw: unknown): GroupRef[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: GroupRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") return null
    const id = (item as { id?: unknown }).id
    const name = (item as { name?: unknown }).name
    if (typeof id !== "number" || !Number.isFinite(id)) return null
    if (typeof name !== "string" || name.length === 0) return null
    out.push({ id, name })
  }
  return out
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "invites:create")

    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    if (!email || !email.includes("@")) {
      return Response.json({ error: "Missing or invalid email" }, { status: 400 })
    }
    const groups = parseGroups(body.groups)
    if (!groups) {
      return Response.json(
        { error: "groups must be a non-empty array of { id: number, name: string }" },
        { status: 400 },
      )
    }
    const locale = typeof body.locale === "string" && body.locale.length > 0 ? body.locale : "en"

    const result = await runEffect(
      queueInvite({
        email,
        groups: groups.map((g) => g.id),
        groupNames: groups.map((g) => g.name),
        invitedBy: auth.principalId,
        locale,
      }).pipe(
        Effect.catchAll((e) => {
          const message =
            e instanceof Error
              ? e.message
              : typeof e === "object" && e !== null && "message" in e
                ? String((e as { message: unknown }).message)
                : "Invite failed"
          return Effect.succeed({ error: message } as const)
        }),
      ),
    )

    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 500 })
    }
    return Response.json({ success: true, message: result.message, email })
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Invite failed: ${err}` }, { status: 500 })
  }
}
