import { Effect } from "effect"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { config } from "~/lib/config.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAccountMutation {
  token: string
  username: string
  password: string
}

export type CreateAccountResult = { _redirect: string } | { error: string }

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleCreateAccount(mutation: CreateAccountMutation) {
  return Effect.gen(function* () {
    const tokenHash = hashToken(mutation.token)
    const repo = yield* InviteRepo
    yield* repo.incrementAttempt(tokenHash).pipe(Effect.ignore)
    yield* acceptInvite(mutation.token, {
      username: mutation.username,
      password: mutation.password,
    })
    return { _redirect: `${config.homeUrl}/welcome` } as CreateAccountResult
  }).pipe(
    Effect.catchAll((e) => {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as any).message)
            : "Failed to create account"
      return Effect.succeed({ error: message } as CreateAccountResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseCreateAccountMutation(
  formData: FormData,
  token: string,
): CreateAccountMutation | { error: string } {
  const username = (formData.get("username") as string)?.trim()
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return {
      error: "Username must be 3-32 characters (letters, numbers, hyphens, underscores)",
    }
  }
  if (!password || password.length < 12) {
    return { error: "Password must be at least 12 characters" }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  return { token, username, password }
}
