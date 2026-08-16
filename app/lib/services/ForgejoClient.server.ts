import { Context, Effect, Data, Layer, Ref, Config, Redacted, Schema } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import { makeJsonApi } from "~/lib/http.server"
import { config } from "~/lib/config.server"

/**
 * ForgejoClient — self-service SSH-key management against the Forgejo forge.
 *
 * All writes go through Forgejo's `sudo` mechanism on the USER endpoints
 * (`POST /api/v1/user/keys?sudo=<u>`, `DELETE /api/v1/user/keys/{id}?sudo=<u>`)
 * with the admin token: verified 2026-08-16 against the live instance
 * (git.daddyshome.fr, Forgejo 13) — `GET /api/v1/user?sudo=…` → 200 with the
 * token's current scopes (`write:user` et al.), while `/api/v1/admin/**` → 403
 * (`write:admin` deliberately NOT granted). Sudo also scopes every operation to
 * that user by construction — the admin route would rely on Forgejo's own
 * ownership checks instead.
 *
 * The admin token is a per-call `unconfigured` failure rather than a boot
 * failure: AppLayer is merged once at first runEffect, so a hard Config read
 * here would take every route down with it.
 */

export interface GitSshKey {
  id: number
  title: string
  fingerprint: string
  createdAt: string
  keyType: string | null
}

export type ForgejoFailure =
  | "account_missing"
  | "unauthorized"
  | "unconfigured"
  | "unavailable"
  | "invalid_key"
  | "key_in_use"
  | "title_taken"
  | "key_not_found"

export class ForgejoClientError extends Data.TaggedError("ForgejoClientError")<{
  readonly kind: ForgejoFailure
  readonly message: string
  readonly cause?: unknown
}> {}

// --- Response schema (Forgejo wire shape; camelCased before it leaves here) ---

const ForgejoPublicKey = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  fingerprint: Schema.String,
  created_at: Schema.String,
  key_type: Schema.optional(Schema.String),
})
const ForgejoPublicKeyList = Schema.mutable(Schema.Array(ForgejoPublicKey))
const decodeKey = Schema.decodeUnknown(ForgejoPublicKey)
const decodeKeyList = Schema.decodeUnknown(ForgejoPublicKeyList)

const toGitSshKey = (k: typeof ForgejoPublicKey.Type): GitSshKey => ({
  id: k.id,
  title: k.title,
  fingerprint: k.fingerprint,
  createdAt: k.created_at,
  keyType: k.key_type ?? null,
})

export class ForgejoClient extends Context.Tag("ForgejoClient")<
  ForgejoClient,
  {
    readonly userExists: (username: string) => Effect.Effect<boolean, ForgejoClientError>
    readonly listKeys: (username: string) => Effect.Effect<GitSshKey[], ForgejoClientError>
    readonly addKey: (
      username: string,
      input: { title: string; key: string },
    ) => Effect.Effect<GitSshKey, ForgejoClientError>
    readonly deleteKey: (username: string, keyId: number) => Effect.Effect<void, ForgejoClientError>
  }
>() {}

// --- helpers -----------------------------------------------------------------

/** Forgejo username charset; anything else never reaches a URL (path-traversal guard). */
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

/** makeJsonApi flattens non-2xx into "<status> - <body>"; recover them here. */
const statusOf = (cause: unknown): number | null => {
  const m = /^(\d{3}) - /.exec(String(cause))
  return m ? Number(m[1]) : null
}
const bodyOf = (cause: unknown): string => String(cause).slice(6, 500).toLowerCase()

export const ForgejoClientLive = Layer.effect(
  ForgejoClient,
  Effect.gen(function* () {
    const baseUrl = config.forgejoUrl
    const timeoutMs = yield* Config.number("FORGEJO_TIMEOUT_MS").pipe(Config.withDefault(8000))
    // withDefault so a missing secret is a per-call failure, never a boot crash
    const token = Redacted.value(
      yield* Config.redacted("FORGEJO_ADMIN_TOKEN").pipe(Config.withDefault(Redacted.make(""))),
    )
    const http = yield* HttpClient.HttpClient

    const api = makeJsonApi(
      http,
      baseUrl,
      { Authorization: `token ${token}`, "Content-Type": "application/json" },
      (cause) =>
        new ForgejoClientError({
          kind: "unavailable",
          message: "Forgejo API call failed",
          cause,
        }),
    )

    /** Common guards: configured + a syntactically safe username. */
    const guard = (username: string): Effect.Effect<string, ForgejoClientError> => {
      if (baseUrl === "" || token === "")
        return Effect.fail(new ForgejoClientError({ kind: "unconfigured", message: "Forgejo is not configured" }))
      if (!USERNAME_RE.test(username))
        return Effect.fail(new ForgejoClientError({ kind: "account_missing", message: "Invalid forge username" }))
      return Effect.succeed(encodeURIComponent(username))
    }

    /** Re-kind a flattened transport error from its embedded status. */
    const rekind = (e: ForgejoClientError, map: Partial<Record<number, ForgejoFailure>>) => {
      const status = statusOf(e.cause)
      const kind = status !== null ? map[status] : undefined
      return kind ? new ForgejoClientError({ kind, message: e.message, cause: e.cause }) : e
    }

    const withTimeout = <A>(eff: Effect.Effect<A, ForgejoClientError>) =>
      eff.pipe(
        Effect.timeoutFail({
          duration: `${timeoutMs} millis`,
          onTimeout: () => new ForgejoClientError({ kind: "unavailable", message: "Forgejo timed out" }),
        }),
      )

    return {
      userExists: (username) =>
        guard(username).pipe(
          Effect.flatMap((u) => withTimeout(api.get(`/api/v1/users/${u}`))),
          Effect.as(true),
          Effect.catchAll((e) => {
            if (e.kind === "unavailable" && statusOf(e.cause) === 404) return Effect.succeed(false)
            if (e.kind === "unavailable" && (statusOf(e.cause) === 401 || statusOf(e.cause) === 403))
              return Effect.fail(rekind(e, { 401: "unauthorized", 403: "unauthorized" }))
            return Effect.fail(e)
          }),
        ),

      listKeys: (username) =>
        guard(username).pipe(
          Effect.flatMap((u) => withTimeout(api.get(`/api/v1/users/${u}/keys`))),
          Effect.flatMap((raw) =>
            decodeKeyList(raw).pipe(
              Effect.mapError(
                (cause) =>
                  new ForgejoClientError({
                    kind: "unavailable",
                    message: "Failed to decode Forgejo key list",
                    cause,
                  }),
              ),
            ),
          ),
          Effect.map((keys) => keys.map(toGitSshKey)),
          Effect.mapError((e) => rekind(e, { 401: "unauthorized", 403: "unauthorized", 404: "account_missing" })),
        ),

      addKey: (username, input) =>
        guard(username).pipe(
          Effect.flatMap((u) =>
            withTimeout(api.post(`/api/v1/user/keys?sudo=${u}`, { title: input.title, key: input.key })),
          ),
          Effect.flatMap((raw) =>
            decodeKey(raw).pipe(
              Effect.mapError(
                (cause) =>
                  new ForgejoClientError({
                    kind: "unavailable",
                    message: "Failed to decode Forgejo key response",
                    cause,
                  }),
              ),
            ),
          ),
          Effect.map(toGitSshKey),
          Effect.mapError((e) => {
            const status = statusOf(e.cause)
            if (status === 422) {
              const body = bodyOf(e.cause)
              // Forgejo 422 bodies: "Key content has been used as non-deploy key" /
              // "key with the same name already exists" — best-effort match,
              // tightened against the live instance during E2E.
              if (/been used|already exists.*content|in use/.test(body) && !/title|name/.test(body))
                return new ForgejoClientError({ kind: "key_in_use", message: e.message, cause: e.cause })
              if (/title|name/.test(body))
                return new ForgejoClientError({ kind: "title_taken", message: e.message, cause: e.cause })
              return new ForgejoClientError({ kind: "invalid_key", message: e.message, cause: e.cause })
            }
            return rekind(e, { 401: "unauthorized", 403: "unauthorized", 404: "account_missing" })
          }),
        ),

      deleteKey: (username, keyId) =>
        guard(username).pipe(
          Effect.flatMap((u) =>
            // hand-rolled: makeJsonApi's 2xx branch calls response.json, which
            // fails on Forgejo's empty 204 body.
            withTimeout(
              http
                .execute(
                  HttpClientRequest.del(`${baseUrl}/api/v1/user/keys/${keyId}?sudo=${u}`).pipe(
                    HttpClientRequest.setHeaders({ Authorization: `token ${token}` }),
                  ),
                )
                .pipe(
                  Effect.flatMap((response) => {
                    if (response.status >= 200 && response.status < 300) return Effect.void
                    return Effect.fail(
                      new ForgejoClientError({
                        kind:
                          response.status === 404
                            ? "key_not_found"
                            : response.status === 401 || response.status === 403
                              ? "unauthorized"
                              : "unavailable",
                        message: `Forgejo delete failed (${response.status})`,
                      }),
                    )
                  }),
                  Effect.mapError((e) =>
                    e instanceof ForgejoClientError
                      ? e
                      : new ForgejoClientError({
                          kind: "unavailable",
                          message: "Forgejo API call failed",
                          cause: e,
                        }),
                  ),
                  Effect.scoped,
                ),
            ),
          ),
        ),
    }
  }),
)

// --- Dev implementation: in-memory fixtures so /settings/git works locally ---

export const ForgejoClientDev = Layer.effect(
  ForgejoClient,
  Effect.gen(function* () {
    const store = yield* Ref.make<GitSshKey[]>([
      {
        id: 1,
        title: "Dev laptop",
        fingerprint: "SHA256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        createdAt: "2026-01-15T10:00:00Z",
        keyType: "ssh-ed25519",
      },
    ])
    const nextId = yield* Ref.make(2)
    return {
      userExists: () => Effect.succeed(true),
      listKeys: () => Ref.get(store),
      addKey: (_u, input) =>
        Effect.gen(function* () {
          const id = yield* Ref.getAndUpdate(nextId, (n) => n + 1)
          const key: GitSshKey = {
            id,
            title: input.title,
            fingerprint: `SHA256:dev-${id}-${input.key.slice(-16)}`,
            createdAt: new Date().toISOString(),
            keyType: input.key.split(" ")[0] ?? null,
          }
          yield* Ref.update(store, (ks) => [...ks, key])
          return key
        }),
      deleteKey: (_u, keyId) => Ref.update(store, (ks) => ks.filter((k) => k.id !== keyId)),
    }
  }),
)
