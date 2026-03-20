// ---------------------------------------------------------------------------
// Metro bundles loaders and API routes as separate files that share a global
// __d module registry.  When the create-account *loader* tree-shakes
// config.server to an empty stub, it registers the module under the same
// numeric ID.  The API route's compiled `r(id)` then resolves to the empty
// stub instead of the real module.
//
// Workaround: inline all code that depends (directly or transitively) on
// config.server.  Heavy deps that don't touch config.server are imported
// via require() which still works for non-stubbed module IDs.
// ---------------------------------------------------------------------------
import { Effect } from "effect"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { runEffect } from "~/lib/runtime.server"

const ALLOWED_SUFFIX = process.env.ALLOWED_ORIGIN_SUFFIX ?? "daddyshome.fr"
const HOME_URL = process.env.HOME_URL ?? "https://home.daddyshome.fr"

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true
  try {
    return new URL(origin).hostname.endsWith(ALLOWED_SUFFIX)
  } catch {
    return false
  }
}

function parseForm(
  formData: FormData,
  token: string,
): { token: string; username: string; password: string } | { error: string } {
  const username = (formData.get("username") as string)?.trim()
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return { error: "Username must be 3-32 characters (letters, numbers, hyphens, underscores)" }
  }
  if (!password || password.length < 12) {
    return { error: "Password must be at least 12 characters" }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }
  return { token, username, password }
}

export async function POST(request: Request, params: Record<string, string>) {
  const token = params.token
  if (!token) {
    return Response.json({ error: "Missing invite token" }, { status: 400 })
  }

  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseForm(formData as any, token)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const program = Effect.gen(function* () {
    const tokenHash = hashToken(parsed.token)
    const repo = yield* InviteRepo
    yield* repo.incrementAttempt(tokenHash).pipe(Effect.ignore)
    yield* acceptInvite(parsed.token, { username: parsed.username, password: parsed.password })
    return { _redirect: `${HOME_URL}/welcome` } as { _redirect: string } | { error: string }
  }).pipe(
    Effect.catchAll((e: unknown) => {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : "Failed to create account"
      return Effect.succeed({ error: message } as { _redirect: string } | { error: string })
    }),
  )

  const result = await runEffect(program)
  if ("_redirect" in result) {
    return new Response(null, {
      status: 302,
      headers: { Location: result._redirect },
    })
  }
  return Response.json(result)
}
