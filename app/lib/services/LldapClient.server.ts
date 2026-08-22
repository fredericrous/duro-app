import { Context, Effect, Data, Layer, Ref, Config, Redacted, Schema, pipe } from "effect"
import { UserManager, UserManagerError } from "./UserManager.server"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"

export interface LldapUser {
  id: string
  email: string
  displayName: string
  creationDate: string
}

export interface LldapGroup {
  id: number
  displayName: string
}

export interface CreateUserInput {
  id: string
  email: string
  displayName: string
  firstName: string
  lastName: string
}

export class LldapError extends Data.TaggedError("LldapError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * base64url (what @serenity-kit/opaque emits) -> standard base64 (what LLDAP's
 * JSON API expects). Padding is restored because Rust's base64 STANDARD engine
 * rejects unpadded input.
 */
export const toStandardB64 = (urlB64: string): string => {
  const b64 = urlB64.replace(/-/g, "+").replace(/_/g, "/")
  return b64 + "=".repeat((4 - (b64.length % 4)) % 4)
}

/** standard base64 (from LLDAP) -> base64url (what @serenity-kit/opaque takes). */
export const toUrlB64 = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/**
 * Parse a JSON body, but fail loudly when the response isn't JSON at all.
 *
 * LLDAP serves its admin SPA from a catch-all, so a typo'd API path returns
 * `200 text/html` rather than a 404. A bare `.json` on that yields an opaque
 * parse error with no hint that the URL was wrong — which is exactly how a
 * mistyped OPAQUE route went unnoticed until a real signup hit it.
 */
const expectJson = (r: HttpClientResponse.HttpClientResponse) => {
  const contentType = r.headers["content-type"] ?? ""
  if (!contentType.includes("json")) {
    return Effect.flatMap(
      r.text,
      (body) =>
        new LldapError({
          message: `Expected JSON from ${r.request.url} but got ${contentType || "no content-type"} (status ${r.status}). This usually means the API path does not exist and LLDAP served its admin UI instead.`,
          cause: body.slice(0, 200),
        }),
    )
  }
  return r.json
}

// --- Response schemas ---

const LoginResponse = Schema.Struct({ token: Schema.String })
const decodeLoginResponse = Schema.decodeUnknown(LoginResponse)

const GraphQLResponse = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
})
const decodeGraphQLResponse = Schema.decodeUnknown(GraphQLResponse)

const UsersData = Schema.Struct({
  users: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        email: Schema.String,
        displayName: Schema.String,
        creationDate: Schema.String,
      }),
    ),
  ),
})
const decodeUsersData = Schema.decodeUnknown(UsersData)

const GroupsData = Schema.Struct({
  groups: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        displayName: Schema.String,
      }),
    ),
  ),
})
const decodeGroupsData = Schema.decodeUnknown(GroupsData)

export class LldapClient extends Context.Tag("LldapClient")<
  LldapClient,
  {
    readonly getUsers: Effect.Effect<LldapUser[], LldapError>
    readonly getGroups: Effect.Effect<LldapGroup[], LldapError>
    readonly createUser: (input: CreateUserInput) => Effect.Effect<void, LldapError>
    readonly setUserPassword: (userId: string, password: string) => Effect.Effect<void, LldapError>
    readonly addUserToGroup: (userId: string, groupId: number) => Effect.Effect<void, LldapError>
    readonly removeUserFromGroup: (userId: string, groupId: number) => Effect.Effect<void, LldapError>
    readonly createGroup: (displayName: string) => Effect.Effect<LldapGroup, LldapError>
    readonly ensureGroup: (displayName: string) => Effect.Effect<number, LldapError>
    readonly deleteUser: (userId: string) => Effect.Effect<void, LldapError>
  }
>() {}

export const LldapClientLive = Layer.effect(
  LldapClient,
  Effect.gen(function* () {
    const url = yield* Config.string("LLDAP_URL").pipe(
      Config.withDefault("http://lldap.lldap.svc.cluster.local.:17170"),
    )
    const adminUser = yield* Config.string("LLDAP_ADMIN_USER").pipe(Config.withDefault("admin"))
    const adminPass = Redacted.value(yield* Config.redacted("LLDAP_ADMIN_PASS"))
    const http = yield* HttpClient.HttpClient

    const tokenRef = yield* Ref.make<{
      token: string
      expiresAt: number
    } | null>(null)

    const mapError = (cause: unknown) =>
      cause instanceof LldapError ? cause : new LldapError({ message: "LLDAP request failed", cause })

    const getToken = Effect.gen(function* () {
      const cached = yield* Ref.get(tokenRef)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token
      }

      const res = yield* http
        .execute(
          HttpClientRequest.post(`${url}/auth/simple/login`).pipe(
            HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
            HttpClientRequest.bodyUnsafeJson({
              username: adminUser,
              password: adminPass,
            }),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((r) => r.json),
          Effect.mapError((e) => new LldapError({ message: "Failed to authenticate with LLDAP", cause: e })),
          Effect.scoped,
        )

      const { token } = yield* decodeLoginResponse(res).pipe(
        Effect.mapError((e) => new LldapError({ message: "No token in LLDAP login response", cause: e })),
      )

      yield* Ref.set(tokenRef, {
        token,
        expiresAt: Date.now() + 50 * 60 * 1000,
      })
      return token
    })

    const graphql = (query: string, variables?: Record<string, unknown>) =>
      Effect.gen(function* () {
        const token = yield* getToken
        const res = yield* http
          .execute(
            HttpClientRequest.post(`${url}/api/graphql`).pipe(
              HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.bodyUnsafeJson({ query, variables }),
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap((r) => r.json),
            Effect.mapError(mapError),
            Effect.scoped,
          )

        const body = yield* decodeGraphQLResponse(res).pipe(
          Effect.mapError((e) => new LldapError({ message: "Invalid GraphQL response", cause: e })),
        )

        if (body.errors?.length) {
          return yield* new LldapError({
            message: `LLDAP GraphQL error: ${body.errors[0].message}`,
          })
        }

        return body.data
      })

    return {
      getUsers: Effect.gen(function* () {
        const raw = yield* graphql(`
          {
            users {
              id
              email
              displayName
              creationDate
            }
          }
        `)
        const data = yield* decodeUsersData(raw).pipe(
          Effect.mapError((e) => new LldapError({ message: "Invalid users response", cause: e })),
        )
        return data.users
      }),

      getGroups: Effect.gen(function* () {
        const raw = yield* graphql(`
          {
            groups {
              id
              displayName
            }
          }
        `)
        const data = yield* decodeGroupsData(raw).pipe(
          Effect.mapError((e) => new LldapError({ message: "Invalid groups response", cause: e })),
        )
        return data.groups
      }),

      createUser: (input: CreateUserInput) =>
        graphql(
          `
            mutation CreateUser($user: CreateUserInput!) {
              createUser(user: $user) {
                id
              }
            }
          `,
          { user: input },
        ).pipe(Effect.asVoid),

      setUserPassword: (userId: string, password: string) =>
        Effect.gen(function* () {
          const token = yield* getToken

          // Load @serenity-kit/opaque (WASM-based OPAQUE client, opaque-ke 4.0).
          //
          // LLDAP carries OPAQUE messages as STANDARD base64 (`+`, `/`, padded)
          // on /auth/opaque/register/{start,finish}; @serenity-kit/opaque speaks
          // base64url (`-`, `_`, unpadded), so every message is translated at
          // the boundary by toStandardB64 / toUrlB64 below. There are no
          // "/base64" variants of these routes — posting to one hits LLDAP's
          // admin-SPA catch-all, which answers 200 text/html, so the request
          // passes a status check and only fails later on JSON parsing.
          const opaque = yield* Effect.tryPromise({
            try: async () => {
              const mod = await import("@serenity-kit/opaque")
              await mod.ready
              return mod
            },
            catch: (e) => new LldapError({ message: "Failed to load OPAQUE module", cause: e }),
          })

          // Step 1: OPAQUE registration start (client-side crypto).
          // The KSF (Argon2) only runs in finishRegistration below — start
          // is just an OPRF blind. @serenity-kit/opaque accordingly accepts
          // keyStretching only on the finish call.
          const { clientRegistrationState, registrationRequest } = yield* Effect.try({
            try: () =>
              opaque.client.startRegistration({
                password,
              }),
            catch: (e) => new LldapError({ message: "OPAQUE startRegistration failed", cause: e }),
          })

          // Step 2: POST /auth/opaque/register/start
          const serverResponse = yield* http
            .execute(
              HttpClientRequest.post(`${url}/auth/opaque/register/start`).pipe(
                HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
                HttpClientRequest.bearerToken(token),
                HttpClientRequest.bodyUnsafeJson({
                  username: userId,
                  registration_start_request: toStandardB64(registrationRequest),
                }),
              ),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.flatMap(expectJson),
              // Keep an already-diagnosed failure (e.g. "LLDAP served HTML, so
              // that path does not exist") instead of flattening it to a
              // generic label that says nothing about the cause.
              Effect.mapError((e) =>
                e instanceof LldapError ? e : new LldapError({ message: "OPAQUE register/start failed", cause: e }),
              ),
              Effect.scoped,
            ) as Effect.Effect<{ server_data: string; registration_response: string }, LldapError>

          // Step 3: OPAQUE registration finish (client-side crypto)
          const { registrationRecord } = yield* Effect.try({
            try: () =>
              opaque.client.finishRegistration({
                password,
                clientRegistrationState,
                registrationResponse: toUrlB64(serverResponse.registration_response),
                keyStretching: { "argon2id-custom": { memory: 19456, iterations: 2, parallelism: 1 } },
              }),
            catch: (e) => new LldapError({ message: "OPAQUE finishRegistration failed", cause: e }),
          })

          // Step 4: POST /auth/opaque/register/finish
          yield* http
            .execute(
              HttpClientRequest.post(`${url}/auth/opaque/register/finish`).pipe(
                HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
                HttpClientRequest.bearerToken(token),
                HttpClientRequest.bodyUnsafeJson({
                  server_data: serverResponse.server_data,
                  registration_upload: toStandardB64(registrationRecord),
                }),
              ),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              // Keep an already-diagnosed failure (e.g. "LLDAP served HTML, so
              // that path does not exist") instead of flattening it to a
              // generic label that says nothing about the cause.
              Effect.mapError((e) =>
                e instanceof LldapError ? e : new LldapError({ message: "OPAQUE register/finish failed", cause: e }),
              ),
              Effect.scoped,
            )
        }),

      addUserToGroup: (userId: string, groupId: number) =>
        graphql(
          `
            mutation AddUserToGroup($userId: String!, $groupId: Int!) {
              addUserToGroup(userId: $userId, groupId: $groupId) {
                ok
              }
            }
          `,
          { userId, groupId },
        ).pipe(Effect.asVoid),

      removeUserFromGroup: (userId: string, groupId: number) =>
        graphql(
          `
            mutation RemoveUserFromGroup($userId: String!, $groupId: Int!) {
              removeUserFromGroup(userId: $userId, groupId: $groupId) {
                ok
              }
            }
          `,
          { userId, groupId },
        ).pipe(Effect.asVoid),

      createGroup: (displayName: string) =>
        Effect.gen(function* () {
          const raw = yield* graphql(
            `
              mutation CreateGroup($name: String!) {
                createGroup(name: $name) {
                  id
                  displayName
                }
              }
            `,
            { name: displayName },
          )
          const data = raw as { createGroup?: { id: number; displayName: string } } | null
          if (!data?.createGroup) {
            return yield* new LldapError({ message: `No createGroup payload for ${displayName}` })
          }
          return data.createGroup
        }),

      ensureGroup: (displayName: string) =>
        Effect.gen(function* () {
          // 1. Lookup existing
          const raw = yield* graphql(`
            {
              groups {
                id
                displayName
              }
            }
          `)
          const parsed = yield* decodeGroupsData(raw).pipe(
            Effect.mapError((e) => new LldapError({ message: "Invalid groups response", cause: e })),
          )
          const match = parsed.groups.find((g) => g.displayName === displayName)
          if (match) return match.id

          // 2. Create
          const created = yield* graphql(
            `
              mutation CreateGroup($name: String!) {
                createGroup(name: $name) {
                  id
                  displayName
                }
              }
            `,
            { name: displayName },
          )
          const payload = created as { createGroup?: { id: number; displayName: string } } | null
          if (!payload?.createGroup) {
            return yield* new LldapError({ message: `No createGroup payload for ${displayName}` })
          }
          return payload.createGroup.id
        }),

      deleteUser: (userId: string) =>
        graphql(
          `
            mutation DeleteUser($userId: String!) {
              deleteUser(userId: $userId) {
                ok
              }
            }
          `,
          { userId },
        ).pipe(Effect.asVoid),
    }
  }),
)

const mapLldapError = (e: LldapError) => new UserManagerError({ message: e.message, cause: e.cause })

export const LldapUserManagerLive = Layer.effect(
  UserManager,
  Effect.gen(function* () {
    const lldap = yield* LldapClient
    return {
      getUsers: pipe(lldap.getUsers, Effect.mapError(mapLldapError)),
      getGroups: pipe(lldap.getGroups, Effect.mapError(mapLldapError)),
      createUser: (input) => pipe(lldap.createUser(input), Effect.mapError(mapLldapError)),
      setUserPassword: (userId, password) =>
        pipe(lldap.setUserPassword(userId, password), Effect.mapError(mapLldapError)),
      addUserToGroup: (userId, groupId) => pipe(lldap.addUserToGroup(userId, groupId), Effect.mapError(mapLldapError)),
      deleteUser: (userId) => pipe(lldap.deleteUser(userId), Effect.mapError(mapLldapError)),
    }
  }),
).pipe(Layer.provide(LldapClientLive))
