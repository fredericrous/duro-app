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
          // Uses LLDAP's /base64 endpoints which accept base64url-encoded raw bytes.
          const opaque = yield* Effect.tryPromise({
            try: async () => {
              const mod = await import("@serenity-kit/opaque")
              await mod.ready
              return mod
            },
            catch: (e) => new LldapError({ message: "Failed to load OPAQUE module", cause: e }),
          })

          // Step 1: OPAQUE registration start (client-side crypto)
          // Argon2 params must match LLDAP's Argon2::default() from the argon2 0.5 crate:
          // memory=19456 KiB, iterations=2, parallelism=1
          const { clientRegistrationState, registrationRequest } = yield* Effect.try({
            try: () =>
              opaque.client.startRegistration({
                password,
                keyStretching: { "argon2id-custom": { memory: 19456, iterations: 2, parallelism: 1 } },
              }),
            catch: (e) => new LldapError({ message: "OPAQUE startRegistration failed", cause: e }),
          })

          // Step 2: POST /auth/opaque/register/start/base64
          const serverResponse = yield* http
            .execute(
              HttpClientRequest.post(`${url}/auth/opaque/register/start/base64`).pipe(
                HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
                HttpClientRequest.bearerToken(token),
                HttpClientRequest.bodyUnsafeJson({
                  username: userId,
                  registration_start_request: registrationRequest,
                }),
              ),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.flatMap((r) => r.json),
              Effect.mapError((e) => new LldapError({ message: "OPAQUE register/start failed", cause: e })),
              Effect.scoped,
            ) as Effect.Effect<{ server_data: string; registration_response: string }, LldapError>

          // Step 3: OPAQUE registration finish (client-side crypto)
          const { registrationRecord } = yield* Effect.try({
            try: () =>
              opaque.client.finishRegistration({
                password,
                clientRegistrationState,
                registrationResponse: serverResponse.registration_response,
                keyStretching: { "argon2id-custom": { memory: 19456, iterations: 2, parallelism: 1 } },
              }),
            catch: (e) => new LldapError({ message: "OPAQUE finishRegistration failed", cause: e }),
          })

          // Step 4: POST /auth/opaque/register/finish/base64
          yield* http
            .execute(
              HttpClientRequest.post(`${url}/auth/opaque/register/finish/base64`).pipe(
                HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
                HttpClientRequest.bearerToken(token),
                HttpClientRequest.bodyUnsafeJson({
                  server_data: serverResponse.server_data,
                  registration_upload: registrationRecord,
                }),
              ),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.mapError((e) => new LldapError({ message: "OPAQUE register/finish failed", cause: e })),
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
