import { Context, Effect, Data, Layer, Ref, Config, Redacted } from "effect"
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

export class LldapClient extends Context.Tag("LldapClient")<
  LldapClient,
  {
    readonly getUsers: Effect.Effect<LldapUser[], LldapError>
    readonly getGroups: Effect.Effect<LldapGroup[], LldapError>
    readonly createUser: (input: CreateUserInput) => Effect.Effect<void, LldapError>
    readonly setUserPassword: (
      userId: string,
      password: string,
    ) => Effect.Effect<void, LldapError>
    readonly addUserToGroup: (
      userId: string,
      groupId: number,
    ) => Effect.Effect<void, LldapError>
    readonly deleteUser: (userId: string) => Effect.Effect<void, LldapError>
  }
>() {}

export const LldapClientLive = Layer.effect(
  LldapClient,
  Effect.gen(function* () {
    const url = yield* Config.string("LLDAP_URL").pipe(Config.withDefault("http://lldap.lldap.svc.cluster.local.:17170"))
    const adminUser = yield* Config.string("LLDAP_ADMIN_USER").pipe(Config.withDefault("admin"))
    const adminPass = Redacted.value(yield* Config.redacted("LLDAP_ADMIN_PASS"))
    const http = yield* HttpClient.HttpClient

    const tokenRef = yield* Ref.make<{
      token: string
      expiresAt: number
    } | null>(null)

    const mapError = (cause: unknown) =>
      cause instanceof LldapError
        ? cause
        : new LldapError({ message: "LLDAP request failed", cause })

    const getToken = Effect.gen(function* () {
      const cached = yield* Ref.get(tokenRef)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token
      }

      const res = yield* http.execute(
        HttpClientRequest.post(`${url}/auth/simple/login`).pipe(
          HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
          HttpClientRequest.bodyUnsafeJson({
            username: adminUser,
            password: adminPass,
          }),
        ),
      ).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((r) => r.json),
        Effect.mapError((e) =>
          new LldapError({ message: "Failed to authenticate with LLDAP", cause: e }),
        ),
        Effect.scoped,
      )

      const { token } = res as { token: string }

      if (!token) {
        return yield* new LldapError({
          message: "No token in LLDAP login response",
        })
      }

      yield* Ref.set(tokenRef, {
        token,
        expiresAt: Date.now() + 50 * 60 * 1000,
      })
      return token
    })

    const graphql = <T = Record<string, unknown>>(
      query: string,
      variables?: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const token = yield* getToken
        const res = yield* http.execute(
          HttpClientRequest.post(`${url}/api/graphql`).pipe(
            HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.bodyUnsafeJson({ query, variables }),
          ),
        ).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((r) => r.json),
          Effect.mapError(mapError),
          Effect.scoped,
        )

        const body = res as {
          data?: T
          errors?: Array<{ message: string }>
        }

        if (body.errors?.length) {
          return yield* new LldapError({
            message: `LLDAP GraphQL error: ${body.errors[0].message}`,
          })
        }

        return body.data as T
      })

    return {
      getUsers: Effect.gen(function* () {
        const data = yield* graphql<{ users: LldapUser[] }>(
          `{ users { id email displayName creationDate } }`,
        )
        return data.users ?? []
      }),

      getGroups: Effect.gen(function* () {
        const data = yield* graphql<{ groups: LldapGroup[] }>(
          `{ groups { id displayName } }`,
        )
        return data.groups ?? []
      }),

      createUser: (input: CreateUserInput) =>
        graphql(
          `mutation CreateUser($user: CreateUserInput!) { createUser(user: $user) { id } }`,
          { user: input },
        ).pipe(Effect.asVoid),

      setUserPassword: (userId: string, password: string) =>
        Effect.gen(function* () {
          const token = yield* getToken
          yield* http.execute(
            HttpClientRequest.post(
              `${url}/api/user/${encodeURIComponent(userId)}/password`,
            ).pipe(
              HttpClientRequest.setHeaders({ "Content-Type": "application/json" }),
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.bodyUnsafeJson({ password }),
            ),
          ).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.mapError((e) =>
              new LldapError({ message: "Failed to set user password", cause: e }),
            ),
            Effect.scoped,
          )
        }),

      addUserToGroup: (userId: string, groupId: number) =>
        graphql(
          `mutation AddUserToGroup($userId: String!, $groupId: Int!) { addUserToGroup(userId: $userId, groupId: $groupId) { ok } }`,
          { userId, groupId },
        ).pipe(Effect.asVoid),

      deleteUser: (userId: string) =>
        graphql(
          `mutation DeleteUser($userId: String!) { deleteUser(userId: $userId) { ok } }`,
          { userId },
        ).pipe(Effect.asVoid),
    }
  }),
)
